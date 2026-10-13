import type { MessageModel } from "./message.model";
import type { Transaction } from "sequelize";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { env } from "../../config/env";
import { UserStatus } from "../../common/enums/domain.enums";
import { SocialService } from "../social/social.service";
import { UsersRepository } from "../users/users.repository";
import { MediaStorageProvider } from "../media/media-storage.port";
import { PushDispatcherService } from "../notifications/delivery/push-dispatcher.service";
import { ChatEventsService } from "./chat-events.service";
import { ChatPresenceService } from "./chat-presence.service";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";
import { ChatMediaCipher } from "./chat-media-cipher";
import { stripChatImageMetadata } from "./chat-image-metadata";
import { SystemChatService } from "./system-chat.service";

const userA = "00000000-0000-4000-8000-00000000000a";
const userB = "00000000-0000-4000-8000-00000000000b";

function createService(
  repositoryOverrides: Partial<ChatRepository>,
  socialOverrides: Partial<SocialService> = {},
  eventsOverrides: Partial<ChatEventsService> = {},
  presenceOverrides: Partial<ChatPresenceService> = {},
  systemChatOverrides: Partial<SystemChatService> = {},
  usersRepositoryOverrides: Partial<UsersRepository> = {},
  pushOverrides: Partial<PushDispatcherService> = {},
  mediaStorageOverrides: Partial<MediaStorageProvider> = {},
  chatMediaCipher = new ChatMediaCipher("test-secret-that-is-long-enough-to-derive-a-key"),
): ChatService {
  return new ChatService(
    {
      // Por defecto nadie más en la conversación: los casos que no van de
      // avisos no deberían tener que declarar destinatarios.
      listOtherParticipants: jest.fn().mockResolvedValue([]),
      publishMessageIfVisible: async (_conversationId: string, _messageId: string, publish: () => void) => { publish(); return true; },
      refreshMessageForResponse: async (message: MessageModel) => message,
      refreshViewedMessageForResponse: async (conversationId: string, messageId: string, viewerId: string) => ({
        id: messageId, conversationId, senderId: userB, viewOnce: true, viewedAt: new Date(),
      } as MessageModel),
      withActiveConversationLock: async (_conversationId: string, operation: (transaction: Transaction) => Promise<unknown>) =>
        operation({} as Transaction),
      withActiveConversationAndReadReceiptLock: async (
        _conversationId: string,
        operation: (transaction: Transaction, participantIds: string[]) => Promise<unknown>,
      ) => operation({} as Transaction, [userA]),
      lockReadReceiptParticipants: jest.fn().mockResolvedValue([userA]),
      readReceiptPolicy: jest.fn().mockResolvedValue({ allowed: true, enabledSince: null }),
      ...repositoryOverrides,
    } as unknown as ChatRepository,
    { isConnected: jest.fn().mockResolvedValue(true), ...socialOverrides } as unknown as SocialService,
    {
      emitMessage: jest.fn(),
      emitDelivered: jest.fn(),
      emitRead: jest.fn(),
      ...eventsOverrides,
    } as unknown as ChatEventsService,
    { isOnline: jest.fn().mockReturnValue(false), ...presenceOverrides } as unknown as ChatPresenceService,
    {
      ensureSystemConversations: jest.fn().mockResolvedValue(undefined),
      ...systemChatOverrides,
    } as unknown as SystemChatService,
    {
      findActiveById: jest.fn().mockResolvedValue({ id: userA, tenantId: "default", status: UserStatus.ACTIVE }),
      ...usersRepositoryOverrides,
    } as unknown as UsersRepository,
    {
      sendToUser: jest.fn().mockResolvedValue({ sent: 1, deactivated: 0 }),
      ...pushOverrides,
    } as unknown as PushDispatcherService,
    {
      name: "local",
      upload: jest.fn().mockResolvedValue({
        provider: "local",
        key: "chat/some-key.jpg",
        url: "http://localhost:3000/media/chat/some-key.jpg",
        sizeBytes: 100,
        checksumSha256: "checksum",
        reused: false,
      }),
      remove: jest.fn(),
      ...mediaStorageOverrides,
    } as unknown as MediaStorageProvider,
    chatMediaCipher,
  );
}

describe("ChatService.getOrStartConversation", () => {
  it("rejects starting a conversation with yourself", async () => {
    const service = createService({});
    await expect(service.getOrStartConversation(userA, "default", userA)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects starting a conversation with someone who is not a connection", async () => {
    const service = createService({}, { isConnected: jest.fn().mockResolvedValue(false) });
    await expect(service.getOrStartConversation(userA, "default", userB)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("allows chat after an explicitly authorized cross-gym connection", async () => {
    const service = createService(
      {
        findDirectConversation: jest.fn().mockResolvedValue(null),
        createDirectConversation: jest.fn().mockResolvedValue("cross-gym-conversation"),
      },
      {},
      {},
      {},
      {},
      { findActiveById: jest.fn().mockResolvedValue({ id: userB, tenantId: "other-gym", status: UserStatus.ACTIVE }) },
    );
    await expect(service.getOrStartConversation(userA, "default", userB)).resolves.toBe("cross-gym-conversation");
  });

  it("reuses an existing direct conversation instead of creating a duplicate", async () => {
    const createDirectConversation = jest.fn();
    const service = createService({
      findDirectConversation: jest.fn().mockResolvedValue("existing-conversation"),
      createDirectConversation,
    });

    const result = await service.getOrStartConversation(userA, "default", userB);

    expect(result).toBe("existing-conversation");
    expect(createDirectConversation).not.toHaveBeenCalled();
  });

  it("creates a new conversation when none exists", async () => {
    const service = createService({
      findDirectConversation: jest.fn().mockResolvedValue(null),
      createDirectConversation: jest.fn().mockResolvedValue("new-conversation"),
    });

    await expect(service.getOrStartConversation(userA, "default", userB)).resolves.toBe(
      "new-conversation",
    );
  });
});

describe("ChatService.sendMessage", () => {
  it("H7.S1.M1 returns the persisted message on a retry without broadcasting twice", async () => {
    let sequence = 0;
    const emitMessage = jest.fn();
    let persisted: Record<string, unknown> | undefined;
    const createMessageIdempotent = jest.fn().mockImplementation(async () => {
      if (persisted) return { message: persisted, created: false };
      persisted = {
        id: `msg-${++sequence}`,
        conversationId: "conv-1",
        senderId: userA,
        body: "hola",
        type: "text",
        clientRequestId: "00000000-0000-4000-8000-000000000010",
        createdAt: new Date("2026-10-09T00:00:00.000Z"),
      };
      return { message: persisted, created: true };
    });
    const service = createService(
      { getParticipant: jest.fn().mockResolvedValue({ canWrite: true }), createMessageIdempotent },
      {}, { emitMessage },
    );

    const sendWithKey = service.sendMessage.bind(service) as (
      conversationId: string, senderId: string, body: string, clientRequestId: string,
    ) => ReturnType<ChatService["sendMessage"]>;
    const first = await sendWithKey("conv-1", userA, "hola", "00000000-0000-4000-8000-000000000010");
    const retry = await sendWithKey("conv-1", userA, "hola", "00000000-0000-4000-8000-000000000010");

    expect(retry.id).toBe(first.id);
    expect(emitMessage).toHaveBeenCalledTimes(1);
  });

  it("refuses to send into a conversation the sender does not belong to", async () => {
    const service = createService({ getParticipant: jest.fn().mockResolvedValue(null) });
    await expect(service.sendMessage("conv-1", userA, "hola")).rejects.toThrow(NotFoundException);
  });

  it("refuses to send into a read-only system conversation", async () => {
    const createMessage = jest.fn();
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: false }),
      createMessage,
    });

    await expect(service.sendMessage("conv-1", userA, "hola")).rejects.toThrow(ForbiddenException);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("persists the message and broadcasts it", async () => {
    const emitMessage = jest.fn();
    const createMessage = jest.fn().mockResolvedValue({
      id: "msg-1",
      conversationId: "conv-1",
      senderId: userA,
      body: "hola",
      createdAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    const service = createService(
      { getParticipant: jest.fn().mockResolvedValue({ canWrite: true }), createMessage },
      {},
      { emitMessage },
    );

    const result = await service.sendMessage("conv-1", userA, "hola");

    expect(createMessage).toHaveBeenCalledWith("conv-1", userA, { type: "text", body: "hola" });
    expect(emitMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "msg-1", body: "hola" }));
    expect(result.body).toBe("hola");
  });
});

describe("ChatService.sendLocationMessage", () => {
  it("persists a location message with no body", async () => {
    const createMessage = jest.fn().mockResolvedValue({
      id: "msg-2",
      conversationId: "conv-1",
      senderId: userA,
      body: null,
      type: "location",
      locationLat: -17.78,
      locationLng: -63.18,
      viewOnce: false,
      viewedAt: null,
      mediaUrl: null,
      mediaMimeType: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      createMessage,
    });

    const result = await service.sendLocationMessage("conv-1", userA, { lat: -17.78, lng: -63.18 });

    expect(createMessage).toHaveBeenCalledWith("conv-1", userA, {
      type: "location",
      locationLat: -17.78,
      locationLng: -63.18,
    });
    expect(result.locationLat).toBe(-17.78);
  });
});

describe("ChatService.sendMediaMessage", () => {
  const photo = readFileSync(join(__dirname, "fixtures/gps-orientation.jpg"));
  const file = { originalname: "photo.jpg", mimetype: "image/jpeg", size: photo.length, buffer: photo };
  const originalMaxBytes = env.CHAT_MEDIA_MAX_BYTES;

  afterEach(() => {
    env.CHAT_MEDIA_MAX_BYTES = originalMaxBytes;
  });

  it("rejects an empty file", async () => {
    const service = createService({});
    await expect(
      service.sendMediaMessage("conv-1", userA, undefined, { type: "image", viewOnce: false }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a file over the size limit", async () => {
    const service = createService({});
    await expect(
      service.sendMediaMessage("conv-1", userA, { ...file, size: 999_999_999 }, { type: "image", viewOnce: false }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an image that exceeds the size limit after re-encoding", async () => {
    const animation = readFileSync(join(__dirname, "fixtures/two-frame.gif"));
    const reencoded = await stripChatImageMetadata(animation, "image/gif");
    expect(animation.length).toBe(66);
    expect(reencoded.length).toBeGreaterThan(70);
    env.CHAT_MEDIA_MAX_BYTES = 70;
    const upload = jest.fn().mockResolvedValue({
      provider: "local", key: "chat/animation.gif", url: "http://localhost:3000/media/chat/animation.gif",
      sizeBytes: reencoded.length, checksumSha256: "checksum", reused: false,
    });
    const service = createService(
      {
        getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
        createMessage: jest.fn().mockResolvedValue({
          id: "animation-message", conversationId: "conv-1", senderId: userA, body: null,
          type: "image", mediaKey: "chat/animation.gif", mediaMimeType: "image/gif",
          viewOnce: false, viewedAt: null, locationLat: null, locationLng: null, createdAt: new Date(),
        }),
      },
      {}, {}, {}, {}, {}, {}, { upload },
    );

    await expect(service.sendMediaMessage("conv-1", userA, {
      originalname: "animation.gif", mimetype: "image/gif", size: animation.length, buffer: animation,
    }, { type: "image", viewOnce: false })).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects a disallowed mime type", async () => {
    const service = createService({});
    await expect(
      service.sendMediaMessage(
        "conv-1",
        userA,
        { ...file, mimetype: "application/zip" },
        { type: "image", viewOnce: false },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("uploads the file and persists a media message", async () => {
    const cipher = new ChatMediaCipher("test-secret-that-is-long-enough-to-derive-a-key");
    const upload = jest.fn().mockResolvedValue({
      provider: "local",
      key: "chat/photo.jpg",
      url: "http://localhost:3000/media/chat/photo.jpg",
      sizeBytes: 1024,
      checksumSha256: "checksum",
      reused: false,
    });
    const message = {
      id: "msg-3",
      conversationId: "conv-1",
      senderId: userA,
      body: null,
      type: "image",
      mediaProvider: "local",
      mediaKey: "chat/photo.jpg",
      mediaUrl: "http://localhost:3000/media/chat/photo.jpg",
      mediaMimeType: "image/jpeg",
      viewOnce: true,
      viewedAt: null,
      locationLat: null,
      locationLng: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
    };
    const createMessage = jest.fn().mockResolvedValue(message);
    const download = jest.fn(async () => upload.mock.calls[0]?.[0].buffer as Buffer);
    const service = createService(
      {
        getParticipant: jest.fn(async (_conversationId: string, userId: string) =>
          [userA, userB].includes(userId)
            ? { canWrite: true } as Awaited<ReturnType<ChatRepository["getParticipant"]>>
            : null),
        getMessage: jest.fn().mockResolvedValue({ ...message, viewedAt: new Date() }),
        createMessage,
      },
      {},
      {},
      {},
      {},
      {},
      {},
      { upload, download },
      cipher,
    );

    const result = await service.sendMediaMessage("conv-1", userA, file, { type: "image", viewOnce: true });

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ originalName: "photo.jpg", mimeType: "image/jpeg", buffer: expect.any(Buffer) }),
      // El adjunto cuelga del perfil de QUIEN LO ENVÍA, dentro de la carpeta de
      // la conversación (ADR-0010).
      { category: "chats", ownerUserId: userA, conversationId: "conv-1" },
    );
    expect(upload.mock.calls[0]?.[0].buffer).not.toEqual(file.buffer);
    const recovered = cipher.decrypt(upload.mock.calls[0]?.[0].buffer as Buffer);
    expect(file.buffer.includes(Buffer.from("Exif\0\0"))).toBe(true);
    expect(recovered.includes(Buffer.from("Exif\0\0"))).toBe(false);
    await expect(service.downloadMedia("conv-1", "msg-3", userB)).resolves.toEqual({
      buffer: recovered,
      mimeType: "image/jpeg",
    });
    await expect(service.downloadMedia("conv-1", "msg-3", "outsider")).rejects.toThrow(NotFoundException);
    expect(download).toHaveBeenCalledTimes(1);
    expect(createMessage).toHaveBeenCalledWith(
      "conv-1",
      userA,
      expect.objectContaining({ type: "image", mediaUrl: expect.any(String), viewOnce: true }),
    );
    // La vista única nunca revela la URL en la respuesta de "enviar" — recién al abrirla.
    expect(result.mediaUrl).toBeNull();
  });

  it("keeps video bytes unchanged before encryption", async () => {
    const cipher = new ChatMediaCipher("test-secret-that-is-long-enough-to-derive-a-key");
    const video = Buffer.from("synthetic mp4 bytes");
    const upload = jest.fn().mockResolvedValue({
      provider: "local", key: "chat/clip.mp4", url: "http://localhost:3000/media/chat/clip.mp4",
      sizeBytes: video.length, checksumSha256: "checksum", reused: false,
    });
    const service = createService(
      {
        getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
        createMessage: jest.fn().mockResolvedValue({
          id: "video-message", conversationId: "conv-1", senderId: userA, body: null,
          type: "video", mediaKey: "chat/clip.mp4", mediaMimeType: "video/mp4",
          viewOnce: false, viewedAt: null, locationLat: null, locationLng: null, createdAt: new Date(),
        }),
      },
      {}, {}, {}, {}, {}, {}, { upload }, cipher,
    );

    await service.sendMediaMessage("conv-1", userA, {
      originalname: "clip.mp4", mimetype: "video/mp4", size: video.length, buffer: video,
    }, { type: "video", viewOnce: false });

    expect(cipher.decrypt(upload.mock.calls[0]?.[0].buffer as Buffer)).toEqual(video);
  });
});

describe("ChatService.downloadMedia", () => {
  const cipher = new ChatMediaCipher("test-secret-that-is-long-enough-to-derive-a-key");

  it("serves decrypted bytes only after confirming active conversation membership", async () => {
    const download = jest.fn().mockResolvedValue(cipher.encrypt(Buffer.from("private bytes")));
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      getMessage: jest.fn().mockResolvedValue({
        id: "msg-1",
        conversationId: "conv-1",
        senderId: userB,
        mediaKey: "users/u/chats/c/file.jpg",
        mediaProvider: "local",
        mediaMimeType: "image/jpeg",
        viewOnce: false,
      }),
    }, {}, {}, {}, {}, {}, {}, { download }, cipher);

    await expect(service.downloadMedia("conv-1", "msg-1", userA)).resolves.toEqual({
      buffer: Buffer.from("private bytes"), mimeType: "image/jpeg",
    });
    expect(download).toHaveBeenCalledWith("users/u/chats/c/file.jpg");
  });

  it("does not fetch media after the conversation has been revoked", async () => {
    const download = jest.fn();
    const service = createService({ getParticipant: jest.fn().mockResolvedValue(null) }, {}, {}, {}, {}, {}, {}, { download }, cipher);

    await expect(service.downloadMedia("conv-1", "msg-1", userA)).rejects.toThrow(NotFoundException);
    expect(download).not.toHaveBeenCalled();
  });

  it("does not serve a view-once file until the recipient opens the message", async () => {
    const download = jest.fn().mockResolvedValue(cipher.encrypt(Buffer.from("private bytes")));
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      getMessage: jest.fn().mockResolvedValue({
        id: "msg-1",
        conversationId: "conv-1",
        senderId: userB,
        mediaKey: "users/u/chats/c/file.jpg",
        mediaProvider: "local",
        mediaMimeType: "image/jpeg",
        viewOnce: true,
        viewedAt: null,
      }),
    }, {}, {}, {}, {}, {}, {}, { download }, cipher);

    await expect(service.downloadMedia("conv-1", "msg-1", userA)).rejects.toThrow(ForbiddenException);
    expect(download).not.toHaveBeenCalled();
  });
});

describe("ChatService.viewMessage", () => {
  it("rejects viewing a message from a conversation the caller does not belong to", async () => {
    const service = createService({ getParticipant: jest.fn().mockResolvedValue(null) });
    await expect(service.viewMessage("conv-1", "msg-1", userA)).rejects.toThrow(NotFoundException);
  });

  it("rejects a message that is not view-once", async () => {
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      tryMarkMessageViewed: jest.fn().mockResolvedValue(null),
      getMessage: jest.fn().mockResolvedValue({ id: "msg-1", senderId: userB, viewOnce: false, viewedAt: null }),
    });
    await expect(service.viewMessage("conv-1", "msg-1", userA)).rejects.toThrow(NotFoundException);
  });

  it("rejects a view-once message that was already viewed", async () => {
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      tryMarkMessageViewed: jest.fn().mockResolvedValue(null),
      getMessage: jest.fn().mockResolvedValue({ id: "msg-1", senderId: userB, viewOnce: true, viewedAt: new Date() }),
    });
    await expect(service.viewMessage("conv-1", "msg-1", userA)).rejects.toThrow(ConflictException);
  });

  it("rejects the sender opening their own view-once message", async () => {
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      tryMarkMessageViewed: jest.fn().mockResolvedValue(null),
      getMessage: jest.fn().mockResolvedValue({ id: "msg-1", senderId: userA, viewOnce: true, viewedAt: null }),
    });
    await expect(service.viewMessage("conv-1", "msg-1", userA)).rejects.toThrow(ForbiddenException);
  });

  it("reveals the media url once, via a single atomic conditional update", async () => {
    const tryMarkMessageViewed = jest.fn().mockResolvedValue({
      id: "msg-1",
      conversationId: "conv-1",
      senderId: userB,
      body: null,
      type: "image",
      mediaKey: "users/u/chats/c/photo.jpg",
      mediaProvider: "local",
      mediaUrl: "http://localhost:3000/media/chat/photo.jpg",
      mediaMimeType: "image/jpeg",
      viewOnce: true,
      viewedAt: new Date(),
      locationLat: null,
      locationLng: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    const refreshViewedMessageForResponse = jest.fn().mockImplementation(async () => tryMarkMessageViewed.mock.results[0].value);
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      tryMarkMessageViewed,
      refreshViewedMessageForResponse,
    });

    const result = await service.viewMessage("conv-1", "msg-1", userA);

    expect(tryMarkMessageViewed).toHaveBeenCalledWith("conv-1", "msg-1", userA);
    expect(refreshViewedMessageForResponse).toHaveBeenCalledWith("conv-1", "msg-1", userA);
    expect(result.mediaUrl).toBe("/me/conversations/conv-1/messages/msg-1/media");
  });

  it("treats a lost race (concurrent opener won) as already viewed, not a crash", async () => {
    const tryMarkMessageViewed = jest.fn().mockResolvedValue(null);
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      tryMarkMessageViewed,
      getMessage: jest.fn().mockResolvedValue({ id: "msg-1", senderId: userB, viewOnce: true, viewedAt: new Date() }),
    });

    await expect(service.viewMessage("conv-1", "msg-1", userA)).rejects.toThrow(ConflictException);
    expect(tryMarkMessageViewed).toHaveBeenCalledWith("conv-1", "msg-1", userA);
  });
});

describe("ChatService.listConversations", () => {
  it("marks the other participant online only when they have an active socket", async () => {
    const row = {
      conversation_id: "conv-1",
      other_user_id: userB,
      other_user_name: "Bea",
      other_user_photo_url: null,
      other_user_last_seen_at: "2026-08-25T00:00:00.000Z",
      last_message_body: null,
      last_message_at: null,
      can_write: true,
      system_kind: null,
      nickname: null,
      other_last_delivered_at: null,
      other_last_read_at: null,
    };
    const service = createService(
      { listConversationsForUser: jest.fn().mockResolvedValue([row]) },
      {},
      {},
      { isOnline: jest.fn().mockReturnValue(true) },
    );

    const [summary] = await service.listConversations(userA);

    expect(summary.otherUserOnline).toBe(true);
    expect(summary.otherUserLastSeenAt).toBe("2026-08-25T00:00:00.000Z");
    expect(summary.canWrite).toBe(true);
    expect(summary.systemKind).toBeNull();
  });

  it("ensures the system conversations exist before listing, using the caller's tenant", async () => {
    const ensureSystemConversations = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      { listConversationsForUser: jest.fn().mockResolvedValue([]) },
      {},
      {},
      {},
      { ensureSystemConversations },
      { findActiveById: jest.fn().mockResolvedValue({ id: userA, tenantId: "topfitness", status: UserStatus.ACTIVE }) },
    );

    await service.listConversations(userA);

    expect(ensureSystemConversations).toHaveBeenCalledWith(userA, "topfitness");
  });

  it("falls back to the default tenant when the caller has none", async () => {
    const ensureSystemConversations = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      { listConversationsForUser: jest.fn().mockResolvedValue([]) },
      {},
      {},
      {},
      { ensureSystemConversations },
      { findActiveById: jest.fn().mockResolvedValue({ id: userA, tenantId: null, status: UserStatus.ACTIVE }) },
    );

    await service.listConversations(userA);

    expect(ensureSystemConversations).toHaveBeenCalledWith(userA, expect.any(String));
  });
});

describe("ChatService.listMessages", () => {
  it("refuses to list messages for a non-participant", async () => {
    const service = createService({ getParticipant: jest.fn().mockResolvedValue(null) });
    await expect(service.listMessages("conv-1", userA, 50)).rejects.toThrow(NotFoundException);
  });

  it("marks the caller's own delivered cursor after fetching the history", async () => {
    const markDelivered = jest.fn().mockResolvedValue(undefined);
    const emitDelivered = jest.fn();
    const service = createService(
      {
        getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
        listMessages: jest.fn().mockResolvedValue([]),
        markDelivered,
      },
      {},
      { emitDelivered },
    );

    await service.listMessages("conv-1", userA, 50);

    expect(markDelivered).toHaveBeenCalledWith("conv-1", userA);
    expect(emitDelivered).toHaveBeenCalledWith("conv-1", expect.objectContaining({ userId: userA }));
  });
});

describe("ChatService.setNickname", () => {
  it("rejects setting a nickname for a conversation the caller does not belong to", async () => {
    const service = createService({ getParticipant: jest.fn().mockResolvedValue(null) });
    await expect(service.setNickname("conv-1", userA, "Apodo")).rejects.toThrow(NotFoundException);
  });

  it("stores the nickname on the caller's own participant row", async () => {
    const setNickname = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      setNickname,
    });

    await service.setNickname("conv-1", userA, "Apodo");

    expect(setNickname).toHaveBeenCalledWith("conv-1", userA, "Apodo");
  });
});

describe("ChatService.markRead", () => {
  it("rejects marking as read a conversation the caller does not belong to", async () => {
    const service = createService({
      withActiveConversationAndReadReceiptLock: async (_conversationId, operation) =>
        operation({} as Transaction, []),
    });
    await expect(service.markRead("conv-1", userA)).rejects.toThrow(NotFoundException);
  });

  it("advances the read cursor and broadcasts both receipts", async () => {
    const markRead = jest.fn().mockResolvedValue(undefined);
    const emitDelivered = jest.fn();
    const emitRead = jest.fn();
    const service = createService(
      {
        getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
        markRead,
        readReceiptPolicy: jest.fn().mockResolvedValue({ allowed: true, enabledSince: null }),
      },
      {},
      { emitDelivered, emitRead },
    );

    await service.markRead("conv-1", userA);

    expect(markRead).toHaveBeenCalledWith("conv-1", userA, true, expect.anything());
    expect(emitDelivered).toHaveBeenCalledWith("conv-1", expect.objectContaining({ userId: userA }));
    expect(emitRead).toHaveBeenCalledWith("conv-1", expect.objectContaining({ userId: userA }));
  });

  it("keeps internal read state but hides the public receipt when either participant opted out", async () => {
    const markRead = jest.fn().mockResolvedValue(undefined);
    const emitDelivered = jest.fn();
    const emitRead = jest.fn();
    const service = createService(
      {
        getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
        markRead,
        readReceiptPolicy: jest.fn().mockResolvedValue({ allowed: false, enabledSince: null }),
      },
      {},
      { emitDelivered, emitRead },
    );

    await service.markRead("conv-1", userA);

    expect(markRead).toHaveBeenCalledWith("conv-1", userA, false, expect.anything());
    expect(emitDelivered).toHaveBeenCalledTimes(1);
    expect(emitRead).not.toHaveBeenCalled();
  });
});

describe("ChatService avisa por push a quien no está conectado", () => {
  const textMessage = {
    id: "msg-push-1",
    conversationId: "conv-1",
    senderId: userA,
    body: "¿Entrenamos mañana?",
    type: "text",
    mediaUrl: null,
    mediaMimeType: null,
    viewOnce: false,
    viewedAt: null,
    locationLat: null,
    locationLng: null,
    createdAt: new Date("2026-09-13T00:00:00.000Z"),
  };

  function serviceWith(
    online: boolean,
    sendToUser = jest.fn().mockResolvedValue({ sent: 1, deactivated: 0 }),
    message: Record<string, unknown> = textMessage,
  ) {
    const service = createService(
      {
        getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
        createMessage: jest.fn().mockResolvedValue(message),
        listOtherParticipants: jest.fn().mockResolvedValue([{ userId: userB }]),
      },
      {},
      {},
      { isOnline: jest.fn().mockReturnValue(online) },
      {},
      { findActiveById: jest.fn().mockResolvedValue({ id: userA, fullName: "Camila Ruiz" }) },
      { sendToUser },
    );
    return { service, sendToUser };
  }

  it("empuja al teléfono del destinatario ausente, con el nombre de quien escribe", async () => {
    const { service, sendToUser } = serviceWith(false);

    await service.sendMessage("conv-1", userA, "¿Entrenamos mañana?");

    expect(sendToUser).toHaveBeenCalledWith(userB, {
      title: "Camila Ruiz",
      body: "¿Entrenamos mañana?",
      // Ruta relativa: quien la resuelve contra su propio origen es el service
      // worker del navegador, y así el mismo aviso vale para cualquier host.
      url: "/chat/conv-1",
    });
  });

  it("no avisa a quien tiene la app abierta — ya le llegó por el socket", async () => {
    const { service, sendToUser } = serviceWith(true);

    await service.sendMessage("conv-1", userA, "¿Entrenamos mañana?");

    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("no adelanta el contenido de una foto de vista única", async () => {
    const { service, sendToUser } = serviceWith(
      false,
      jest.fn().mockResolvedValue({ sent: 1, deactivated: 0 }),
      {
        ...textMessage,
        id: "msg-push-2",
        body: null,
        type: "image",
        viewOnce: true,
        mediaUrl: "http://localhost:3000/media/chat/photo.jpg",
        mediaMimeType: "image/jpeg",
      },
    );

    await service.sendMessage("conv-1", userA, "");

    expect(sendToUser).toHaveBeenCalledWith(userB, {
      title: "Camila Ruiz",
      body: "Te envió una foto de vista única",
      url: "/chat/conv-1",
    });
  });

  it("recorta un mensaje largo en vez de mandarlo entero a la pantalla bloqueada", async () => {
    const largo = "a".repeat(300);
    const { service, sendToUser } = serviceWith(
      false,
      jest.fn().mockResolvedValue({ sent: 1, deactivated: 0 }),
      { ...textMessage, body: largo },
    );

    await service.sendMessage("conv-1", userA, largo);

    const [[, notification]] = sendToUser.mock.calls as [[string, { body: string }]];
    expect(notification.body).toHaveLength(140);
    expect(notification.body.endsWith("…")).toBe(true);
  });

  it("un fallo al resolver destinatarios no rompe el envío del mensaje", async () => {
    const service = createService(
      {
        getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
        createMessage: jest.fn().mockResolvedValue(textMessage),
        listOtherParticipants: jest.fn().mockRejectedValue(new Error("base caída")),
      },
      {},
      {},
      { isOnline: jest.fn().mockReturnValue(false) },
      {},
      {},
      {},
    );

    // El mensaje ya está escrito y emitido: el push es un añadido, no una
    // condición para que exista.
    await expect(service.sendMessage("conv-1", userA, "hola")).resolves.toMatchObject({
      id: "msg-push-1",
    });
  });
});

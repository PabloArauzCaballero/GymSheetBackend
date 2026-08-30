import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { UserStatus } from "../../common/enums/domain.enums";
import { SocialService } from "../social/social.service";
import { UsersRepository } from "../users/users.repository";
import { MediaStorageProvider } from "../media/media-storage.port";
import { ChatEventsService } from "./chat-events.service";
import { ChatPresenceService } from "./chat-presence.service";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";
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
  mediaStorageOverrides: Partial<MediaStorageProvider> = {},
): ChatService {
  return new ChatService(
    repositoryOverrides as ChatRepository,
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

  it("rejects starting a conversation with someone from a different tenant", async () => {
    const service = createService(
      {},
      {},
      {},
      {},
      {},
      { findActiveById: jest.fn().mockResolvedValue({ id: userB, tenantId: "other-gym", status: UserStatus.ACTIVE }) },
    );
    await expect(service.getOrStartConversation(userA, "default", userB)).rejects.toThrow(
      ForbiddenException,
    );
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
  const file = { originalname: "photo.jpg", mimetype: "image/jpeg", size: 1024, buffer: Buffer.from("x") };

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
    const upload = jest.fn().mockResolvedValue({
      provider: "local",
      key: "chat/photo.jpg",
      url: "http://localhost:3000/media/chat/photo.jpg",
      sizeBytes: 1024,
      checksumSha256: "checksum",
      reused: false,
    });
    const createMessage = jest.fn().mockResolvedValue({
      id: "msg-3",
      conversationId: "conv-1",
      senderId: userA,
      body: null,
      type: "image",
      mediaUrl: "http://localhost:3000/media/chat/photo.jpg",
      mediaMimeType: "image/jpeg",
      viewOnce: true,
      viewedAt: null,
      locationLat: null,
      locationLng: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    const service = createService(
      { getParticipant: jest.fn().mockResolvedValue({ canWrite: true }), createMessage },
      {},
      {},
      {},
      {},
      {},
      { upload },
    );

    const result = await service.sendMediaMessage("conv-1", userA, file, { type: "image", viewOnce: true });

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ originalName: "photo.jpg", mimeType: "image/jpeg" }),
    );
    expect(createMessage).toHaveBeenCalledWith(
      "conv-1",
      userA,
      expect.objectContaining({ type: "image", mediaUrl: expect.any(String), viewOnce: true }),
    );
    // La vista única nunca revela la URL en la respuesta de "enviar" — recién al abrirla.
    expect(result.mediaUrl).toBeNull();
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
      mediaUrl: "http://localhost:3000/media/chat/photo.jpg",
      mediaMimeType: "image/jpeg",
      viewOnce: true,
      viewedAt: new Date(),
      locationLat: null,
      locationLng: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    const service = createService({
      getParticipant: jest.fn().mockResolvedValue({ canWrite: true }),
      tryMarkMessageViewed,
    });

    const result = await service.viewMessage("conv-1", "msg-1", userA);

    expect(tryMarkMessageViewed).toHaveBeenCalledWith("conv-1", "msg-1", userA);
    expect(result.mediaUrl).toBe("http://localhost:3000/media/chat/photo.jpg");
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
    const service = createService({ getParticipant: jest.fn().mockResolvedValue(null) });
    await expect(service.markRead("conv-1", userA)).rejects.toThrow(NotFoundException);
  });

  it("advances the read cursor and broadcasts both receipts", async () => {
    const markRead = jest.fn().mockResolvedValue(undefined);
    const emitDelivered = jest.fn();
    const emitRead = jest.fn();
    const service = createService(
      { getParticipant: jest.fn().mockResolvedValue({ canWrite: true }), markRead },
      {},
      { emitDelivered, emitRead },
    );

    await service.markRead("conv-1", userA);

    expect(markRead).toHaveBeenCalledWith("conv-1", userA);
    expect(emitDelivered).toHaveBeenCalledWith("conv-1", expect.objectContaining({ userId: userA }));
    expect(emitRead).toHaveBeenCalledWith("conv-1", expect.objectContaining({ userId: userA }));
  });
});

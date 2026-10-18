import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Socket } from "socket.io";
import type { Transaction } from "sequelize";
import { ChatGateway } from "./chat.gateway";
import { mapMessageToResponse, replyPreviewOf } from "./chat.mapper";
import { ChatRepository } from "./chat.repository";
import {
  forwardMessageSchema,
  isReactionEmoji,
  sendMediaMessageSchema,
  sendMessageSchema,
  setReactionSchema,
  typingSchema,
} from "./chat.schemas";
import { ChatService } from "./chat.service";
import { MessageMutationsService } from "./message-mutations.service";
import type { MessageModel } from "./message.model";

const conversationId = "00000000-0000-4000-8000-000000000001";
const otherConversationId = "00000000-0000-4000-8000-000000000002";
const messageId = "00000000-0000-4000-8000-000000000010";
const targetId = "00000000-0000-4000-8000-000000000011";
const userA = "00000000-0000-4000-8000-00000000000a";
const userB = "00000000-0000-4000-8000-00000000000b";

function message(overrides: Partial<MessageModel> = {}): MessageModel {
  return {
    id: messageId,
    conversationId,
    senderId: userA,
    clientRequestId: null,
    body: "hola",
    type: "text",
    storyId: null,
    mediaKey: null,
    mediaMimeType: null,
    mediaProvider: null,
    viewOnce: false,
    viewedAt: null,
    locationLat: null,
    locationLng: null,
    locationLabel: null,
    expiresAt: null,
    editedAt: null,
    deletedAt: null,
    replyToId: null,
    forwarded: false,
    createdAt: new Date("2026-10-18T12:00:00.000Z"),
    ...overrides,
  } as MessageModel;
}

describe("chat schemas: replies, reactions, forward, typing", () => {
  it.each(["👍", "❤️", "😂", "👍🏽", "👨‍👩‍👧", "🇧🇴", "1️⃣", "🔥"])("accepts the emoji %s", (emoji) => {
    expect(isReactionEmoji(emoji)).toBe(true);
    expect(setReactionSchema.safeParse({ emoji }).success).toBe(true);
  });

  it.each(["", "a", "1", "#", "hola", "👍 ", "<script>", "👍".repeat(9)])("rejects %p as a reaction", (emoji) => {
    expect(setReactionSchema.safeParse({ emoji }).success).toBe(false);
  });

  it("accepts null to remove a reaction and rejects extra keys", () => {
    expect(setReactionSchema.safeParse({ emoji: null }).success).toBe(true);
    expect(setReactionSchema.safeParse({ emoji: "👍", userId: userB }).success).toBe(false);
  });

  it("takes an optional uuid replyToId on text, location, sticker and media", () => {
    expect(sendMessageSchema.safeParse({ type: "text", body: "sí", replyToId: targetId }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ type: "location", locationLat: 1, locationLng: 2, replyToId: targetId }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ type: "sticker", stickerId: "flex", replyToId: "nope" }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ type: "text", body: "sí", replyToId: "nope" }).success).toBe(false);
    expect(sendMediaMessageSchema.safeParse({ type: "image", replyToId: targetId }).success).toBe(true);
    expect(sendMediaMessageSchema.safeParse({ type: "image", replyToId: "x" }).success).toBe(false);
  });

  it("validates forward and typing payloads strictly", () => {
    expect(forwardMessageSchema.safeParse({ fromConversationId: conversationId, messageId }).success).toBe(true);
    expect(forwardMessageSchema.safeParse({ fromConversationId: conversationId }).success).toBe(false);
    expect(typingSchema.safeParse({ conversationId, typing: true }).success).toBe(true);
    expect(typingSchema.safeParse({ conversationId, typing: "yes" }).success).toBe(false);
    expect(typingSchema.safeParse({ conversationId, typing: true, userId: userA }).success).toBe(false);
  });
});

describe("chat mapper: replyTo, reactions and forwarded", () => {
  it("previews text, captions and place labels but never view-once, audio or stickers", () => {
    expect(replyPreviewOf(message({ id: targetId }), false)).toEqual({
      messageId: targetId, senderId: userA, type: "text", body: "hola", available: true,
    });
    expect(replyPreviewOf(message({ type: "image", body: "pie" }), false)?.body).toBe("pie");
    expect(replyPreviewOf(message({ type: "image", body: "pie", viewOnce: true }), false)?.body).toBeNull();
    expect(replyPreviewOf(message({ type: "location", body: null, locationLabel: "Gimnasio X" }), false)?.body).toBe("Gimnasio X");
    expect(replyPreviewOf(message({ type: "audio", body: null }), false)?.body).toBeNull();
    expect(replyPreviewOf(message({ type: "sticker", body: "flex" }), false)?.body).toBeNull();
  });

  it("truncates long quotes to 200 characters", () => {
    const body = replyPreviewOf(message({ body: "x".repeat(500) }), false)?.body ?? "";
    expect(body).toHaveLength(200);
    expect(body.endsWith("…")).toBe(true);
  });

  it("marks deleted, expired or hidden originals as unavailable without their content", () => {
    const unavailable = { body: null, available: false };
    expect(replyPreviewOf(message({ deletedAt: new Date() }), false)).toMatchObject(unavailable);
    expect(replyPreviewOf(message({ expiresAt: new Date(Date.now() - 1000) }), false)).toMatchObject(unavailable);
    expect(replyPreviewOf(message(), true)).toMatchObject(unavailable);
    expect(replyPreviewOf(undefined, false)).toBeNull();
  });

  it("maps extras and the forwarded flag; a tombstone carries none of them", () => {
    const extras = {
      replyTo: { messageId: targetId, senderId: userB, type: "text" as const, body: "¿vamos?", available: true },
      reactions: [{ userId: userB, emoji: "👍" }],
    };
    const mapped = mapMessageToResponse(message({ replyToId: targetId, forwarded: true }), { extras });
    expect(mapped).toMatchObject({ replyTo: extras.replyTo, reactions: extras.reactions, forwarded: true });

    const plain = mapMessageToResponse(message());
    expect(plain).toMatchObject({ replyTo: null, reactions: [], forwarded: false });

    const tombstone = mapMessageToResponse(message({ deletedAt: new Date(), forwarded: true }), { extras });
    expect(tombstone).toMatchObject({ replyTo: null, reactions: [], forwarded: false });
  });
});

describe("ChatRepository.messageExtras", () => {
  it("resolves quotes and reactions for a page in three fixed queries", async () => {
    const messages = {
      findAll: jest.fn().mockResolvedValue([
        message({ id: targetId, senderId: userB, body: "¿a qué hora?" }),
      ]),
    };
    const visibility = { findAll: jest.fn().mockResolvedValue([]) };
    const reactions = {
      findAll: jest.fn().mockResolvedValue([
        { messageId, userId: userB, emoji: "❤️" },
        { messageId, userId: userA, emoji: "👍" },
      ]),
    };
    const repository = new ChatRepository(
      {} as never, {} as never, {} as never, messages as never, visibility as never, reactions as never,
    );
    const second = "00000000-0000-4000-8000-000000000012";
    const extras = await repository.messageExtras([
      { id: messageId, conversationId, replyToId: targetId },
      { id: second, conversationId, replyToId: null },
    ], userA);

    expect(messages.findAll).toHaveBeenCalledTimes(1);
    expect(visibility.findAll).toHaveBeenCalledTimes(1);
    expect(reactions.findAll).toHaveBeenCalledTimes(1);
    expect(extras.get(messageId)).toEqual({
      replyTo: { messageId: targetId, senderId: userB, type: "text", body: "¿a qué hora?", available: true },
      reactions: [{ userId: userB, emoji: "❤️" }, { userId: userA, emoji: "👍" }],
    });
    expect(extras.get(second)).toEqual({ replyTo: null, reactions: [] });
  });

  it("never quotes a message from another conversation and hides what the viewer hid", async () => {
    const messages = { findAll: jest.fn().mockResolvedValue([message({ id: targetId, conversationId: otherConversationId })]) };
    const repository = new ChatRepository(
      {} as never, {} as never, {} as never, messages as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
    );
    const extras = await repository.messageExtras([{ id: messageId, conversationId, replyToId: targetId }], userA);
    expect(extras.get(messageId)?.replyTo).toBeNull();

    const hiddenRepository = new ChatRepository(
      {} as never, {} as never, {} as never,
      { findAll: jest.fn().mockResolvedValue([message({ id: targetId })]) } as never,
      { findAll: jest.fn().mockResolvedValue([{ messageId: targetId }]) } as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
    );
    const hidden = await hiddenRepository.messageExtras([{ id: messageId, conversationId, replyToId: targetId }], userA);
    expect(hidden.get(messageId)?.replyTo).toMatchObject({ available: false, body: null });
  });
});

describe("MessageMutationsService.setReaction", () => {
  function setup({
    participant = { canWrite: true },
    found = message({ senderId: userB }),
  }: { participant?: { canWrite: boolean }; found?: MessageModel | null } = {}) {
    const reactions = { upsert: jest.fn().mockResolvedValue(undefined), destroy: jest.fn().mockResolvedValue(1) };
    const events = { emitMessageReaction: jest.fn() };
    const repository = {
      visibleTo: jest.fn().mockReturnValue({}),
      listReactions: jest.fn().mockResolvedValue([{ userId: userA, emoji: "🔥" }]),
      publishIfMessageAlive: jest.fn(async (_c: string, _m: string, publish: () => void) => { publish(); return true; }),
    };
    const service = new MessageMutationsService(
      { transaction: (operation: (transaction: Transaction) => Promise<unknown>) => operation({ LOCK: { UPDATE: "UPDATE" } } as unknown as Transaction) } as never,
      { findByPk: jest.fn().mockResolvedValue({ id: conversationId, revokedAt: null }) } as never,
      { findOne: jest.fn().mockResolvedValue(participant) } as never,
      { findOne: jest.fn().mockResolvedValue(found) } as never,
      events as never,
      {} as never,
      repository as never,
      reactions as never,
    );
    return { service, reactions, events, repository };
  }

  it("upserts one reaction per person and emits the full state", async () => {
    const { service, reactions, events } = setup();
    const result = await service.setReaction(conversationId, messageId, userA, "🔥");
    expect(reactions.upsert).toHaveBeenCalledWith({ messageId, userId: userA, emoji: "🔥" }, expect.anything());
    expect(result).toEqual({ conversationId, messageId, reactions: [{ userId: userA, emoji: "🔥" }] });
    expect(events.emitMessageReaction).toHaveBeenCalledWith(result);
  });

  it("removes only the caller's reaction with null", async () => {
    const { service, reactions } = setup();
    await service.setReaction(conversationId, messageId, userA, null);
    expect(reactions.destroy).toHaveBeenCalledWith({ where: { messageId, userId: userA }, transaction: expect.anything() });
    expect(reactions.upsert).not.toHaveBeenCalled();
  });

  it("answers 404 for a message the caller cannot see and 403 in a read-only chat", async () => {
    await expect(setup({ found: null }).service.setReaction(conversationId, messageId, userA, "👍"))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ participant: { canWrite: false } }).service.setReaction(conversationId, messageId, userA, "👍"))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects something that is not an emoji before touching the database", async () => {
    const { service, reactions } = setup();
    await expect(service.setReaction(conversationId, messageId, userA, "hola")).rejects.toBeInstanceOf(BadRequestException);
    expect(reactions.upsert).not.toHaveBeenCalled();
  });
});

describe("ChatService.forwardMessage", () => {
  function setup(source: MessageModel | null, { canWrite = true } = {}) {
    const createMessage = jest.fn(async (conversation: string, sender: string, fields: Partial<MessageModel>) =>
      message({ id: "00000000-0000-4000-8000-000000000099", conversationId: conversation, senderId: sender, ...fields }));
    const repository = {
      getParticipant: jest.fn(async (conversation: string) => ({ conversationId: conversation, canWrite: conversation === otherConversationId ? canWrite : true })),
      getMessage: jest.fn().mockResolvedValue(source),
      createMessage,
      messageExtras: jest.fn().mockResolvedValue(new Map()),
      publishMessageIfVisible: jest.fn(async (_c: string, _m: string, publish: () => void) => { publish(); return true; }),
      refreshMessageForResponse: jest.fn(async (created: MessageModel) => created),
      listOtherParticipants: jest.fn().mockResolvedValue([]),
    };
    const storage = {
      name: "local",
      download: jest.fn().mockResolvedValue(Buffer.from("cipher-bytes")),
      upload: jest.fn().mockResolvedValue({ provider: "local", key: "chats/new-key", url: "/x", sizeBytes: 12 }),
    };
    const events = { emitMessage: jest.fn() };
    const service = new ChatService(
      repository as never, {} as never, events as never, { isOnline: () => false } as never,
      {} as never, {} as never, {} as never, storage as never, {} as never,
    );
    return { service, repository, storage, events, createMessage };
  }

  it("copies a text as a new forwarded message in the target conversation", async () => {
    const { service, createMessage, events } = setup(message({ body: "Rutina de piernas", replyToId: targetId }));
    const result = await service.forwardMessage(otherConversationId, userA, conversationId, messageId);
    expect(createMessage).toHaveBeenCalledWith(otherConversationId, userA, { type: "text", body: "Rutina de piernas", forwarded: true });
    expect(result).toMatchObject({ conversationId: otherConversationId, forwarded: true, replyTo: null });
    expect(events.emitMessage).toHaveBeenCalled();
  });

  it("re-uploads the encrypted media bytes under the forwarder's folder without sharing the key", async () => {
    const { service, storage, createMessage } = setup(message({
      type: "image", body: "pie", mediaKey: "chats/original", mediaProvider: "local", mediaMimeType: "image/jpeg",
    }));
    await service.forwardMessage(otherConversationId, userA, conversationId, messageId);
    expect(storage.download).toHaveBeenCalledWith("chats/original");
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: Buffer.from("cipher-bytes"), mimeType: "image/jpeg" }),
      { category: "chats", ownerUserId: userA, conversationId: otherConversationId },
    );
    expect(createMessage).toHaveBeenCalledWith(otherConversationId, userA, expect.objectContaining({
      type: "image", body: "pie", mediaKey: "chats/new-key", viewOnce: false, forwarded: true,
    }));
  });

  it("refuses view-once, missing originals and read-only targets", async () => {
    await expect(setup(message({ type: "image", viewOnce: true })).service.forwardMessage(otherConversationId, userA, conversationId, messageId))
      .rejects.toThrow("Los mensajes de vista única no se pueden reenviar.");
    await expect(setup(null).service.forwardMessage(otherConversationId, userA, conversationId, messageId))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(message(), { canWrite: false }).service.forwardMessage(otherConversationId, userA, conversationId, messageId))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("ChatGateway typing", () => {
  function gateway() {
    return new ChatGateway({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  }

  it("relays typing to the rest of the joined room, never back to the sender", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const client = { data: { userId: userA }, rooms: new Set([`conversation:${conversationId}`]), to } as unknown as Socket;
    expect(gateway().handleTyping(client, { conversationId, typing: true })).toEqual({ ok: true });
    expect(to).toHaveBeenCalledWith(`conversation:${conversationId}`);
    expect(emit).toHaveBeenCalledWith("typing:update", { conversationId, userId: userA, typing: true });
  });

  it("ignores sockets outside the room, unauthenticated sockets and bad payloads", () => {
    const to = jest.fn();
    const outside = { data: { userId: userA }, rooms: new Set<string>(), to } as unknown as Socket;
    const anonymous = { data: {}, rooms: new Set([`conversation:${conversationId}`]), to } as unknown as Socket;
    expect(gateway().handleTyping(outside, { conversationId, typing: true })).toEqual({ ok: false });
    expect(gateway().handleTyping(anonymous, { conversationId, typing: true })).toEqual({ ok: false });
    expect(gateway().handleTyping(outside, { conversationId: "x", typing: true })).toEqual({ ok: false });
    expect(to).not.toHaveBeenCalled();
  });
});

import type { Transaction } from "sequelize";
import { MessageMutationsService } from "./message-mutations.service";
import type { MessageModel } from "./message.model";

const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000010";
const sender = "00000000-0000-4000-8000-00000000000a";
const transaction = { LOCK: { UPDATE: "UPDATE" } } as unknown as Transaction;

function setup(media: { mediaKey: string | null; mediaProvider: string | null }, held = false) {
  const message = {
    id: messageId,
    conversationId,
    senderId: sender,
    type: media.mediaKey ? "image" : "text",
    body: null,
    idempotencyBody: null,
    clientRequestId: null,
    editedAt: null,
    deletedAt: null,
    expiresAt: null,
    createdAt: new Date(Date.now() - 60_000),
    ...media,
    update: jest.fn(function (this: Record<string, unknown>, values: Record<string, unknown>) {
      Object.assign(message, values);
      return Promise.resolve();
    }),
  } as unknown as MessageModel & { update: jest.Mock };
  const mediaRelease = { requestRelease: jest.fn().mockResolvedValue(undefined) };
  const service = new MessageMutationsService(
    { transaction: (work: (t: Transaction) => Promise<unknown>) => work(transaction) } as never,
    { findByPk: jest.fn().mockResolvedValue({ id: conversationId, revokedAt: null }) } as never,
    { findOne: jest.fn().mockResolvedValue({ canWrite: true }) } as never,
    { findOne: jest.fn().mockResolvedValue(message) } as never,
    { emitMessageDeleted: jest.fn() } as never,
    {} as never,
    { publishDeletion: jest.fn().mockResolvedValue(true) } as never,
    { destroy: jest.fn().mockResolvedValue(0) } as never,
    mediaRelease as never,
    { isHeld: jest.fn().mockResolvedValue(held) } as never,
  );
  return { service, message, mediaRelease };
}

describe("MessageMutationsService.deleteMessage media release", () => {
  it("queues the removal of the stored blob in the transaction that clears the message", async () => {
    const { service, message, mediaRelease } = setup({ mediaKey: "users/a/chats/c/blob.bin", mediaProvider: "local" });

    await service.deleteMessage(conversationId, messageId, sender, { scope: "EVERYONE" });

    expect(mediaRelease.requestRelease).toHaveBeenCalledWith(
      { aggregateType: "chat.message", aggregateId: messageId, provider: "local", storageKey: "users/a/chats/c/blob.bin" },
      transaction,
    );
    expect(message.update).toHaveBeenCalledWith(expect.objectContaining({ mediaKey: null }), { transaction });
  });

  it("queues nothing for a text message", async () => {
    const { service, mediaRelease } = setup({ mediaKey: null, mediaProvider: null });
    await service.deleteMessage(conversationId, messageId, sender, { scope: "EVERYONE" });
    expect(mediaRelease.requestRelease).not.toHaveBeenCalled();
  });

  it("keeps the stored blob of a reported message: its evidence copy still points to it", async () => {
    const { service, message, mediaRelease } = setup({ mediaKey: "users/a/chats/c/blob.bin", mediaProvider: "local" }, true);
    await service.deleteMessage(conversationId, messageId, sender, { scope: "EVERYONE" });
    expect(mediaRelease.requestRelease).not.toHaveBeenCalled();
    expect(message.update).toHaveBeenCalledWith(expect.objectContaining({ mediaKey: null, body: null }), { transaction });
  });
});

import { ConflictException, NotFoundException } from "@nestjs/common";
import { Sequelize } from "sequelize-typescript";
import { ReadReceiptSettingsService } from "./read-receipt-settings.service";

const userId = "00000000-0000-4000-8000-00000000000a";
const conversationA = "10000000-0000-4000-8000-00000000000a";
const conversationB = "10000000-0000-4000-8000-00000000000b";

function createService(queryResults: unknown[]) {
  const query = jest.fn();
  for (const result of queryResults) query.mockResolvedValueOnce(result);
  const emitReadReceiptSettingsChanged = jest.fn();
  const chatRepository = { conversationIdsForUser: jest.fn().mockResolvedValue([conversationA, conversationB]) };
  const chatEvents = { emitReadReceiptSettingsChanged };
  const sequelize = {
    query,
    transaction: jest.fn((work: (transaction: object) => Promise<unknown>) => work({ LOCK: { UPDATE: "UPDATE" } })),
  } as unknown as Sequelize;
  return {
    service: new ReadReceiptSettingsService(sequelize, chatRepository as never, chatEvents as never),
    query,
    chatRepository,
    emitReadReceiptSettingsChanged,
  };
}

describe("ReadReceiptSettingsService", () => {
  it("stores selected conversation overrides and increments the version once", async () => {
    const { service, query, emitReadReceiptSettingsChanged } = createService([
      [{ id: userId }],
      [],
      [{ enabled: true, version: 0 }],
      [{ conversation_id: conversationA }, { conversation_id: conversationB }],
      [],
      [],
    ]);

    await expect(service.update(userId, {
      expectedVersion: 0,
      scope: "SELECTED",
      conversationIds: [conversationA, conversationB],
      enabled: false,
    })).resolves.toEqual({ enabled: true, defaultEnabled: true, conversationOverride: null, version: 1 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET read_receipts_enabled = :enabled"))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toContain("version = version + 1");
    expect(emitReadReceiptSettingsChanged).toHaveBeenCalledTimes(2);
  });

  it("clears overrides and changes the default for all existing and future conversations", async () => {
    const { service, query, chatRepository, emitReadReceiptSettingsChanged } = createService([
      [{ id: userId }],
      [],
      [{ enabled: true, version: 3 }],
      [],
      [],
    ]);
    await expect(service.update(userId, {
      expectedVersion: 3,
      scope: "ALL",
      enabled: false,
    })).resolves.toEqual({ enabled: false, defaultEnabled: false, conversationOverride: null, version: 4 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET read_receipts_enabled = NULL"))).toBe(true);
    expect(chatRepository.conversationIdsForUser).toHaveBeenCalledWith(userId);
    expect(emitReadReceiptSettingsChanged).toHaveBeenCalledTimes(2);
  });

  it("rejects stale versions before changing any conversation preference", async () => {
    const { service, query, emitReadReceiptSettingsChanged } = createService([
      [{ id: userId }],
      [],
      [{ enabled: true, version: 2 }],
    ]);
    await expect(service.update(userId, {
      expectedVersion: 1,
      scope: "CONVERSATION",
      conversationId: conversationA,
      enabled: false,
    })).rejects.toThrow(ConflictException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE chat.participants"))).toBe(false);
    expect(emitReadReceiptSettingsChanged).not.toHaveBeenCalled();
  });

  it("does not allow setting preferences for a conversation outside the user's account", async () => {
    const { service, query, emitReadReceiptSettingsChanged } = createService([
      [{ id: userId }],
      [],
      [{ enabled: true, version: 0 }],
      [],
    ]);
    await expect(service.update(userId, {
      expectedVersion: 0,
      scope: "CONVERSATION",
      conversationId: conversationA,
      enabled: false,
    })).rejects.toThrow(NotFoundException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE chat.participants"))).toBe(false);
    expect(emitReadReceiptSettingsChanged).not.toHaveBeenCalled();
  });
});

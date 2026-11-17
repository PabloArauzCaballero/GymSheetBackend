import { NotFoundException } from "@nestjs/common";
import { UniqueConstraintError } from "sequelize";
import { BusinessChatRepository } from "./business-chat.repository";
import { assertBusinessDisappearingAllowed, assertBusinessMessageAllowed } from "./business-chat.rules";
import { BusinessChatService } from "./business-chat.service";
import { ChatEventsService } from "./chat-events.service";
import { mapConversationSummary } from "./chat.mapper";
import type { ConversationSummaryRow } from "./chat.repository";

const personId = "00000000-0000-4000-8000-0000000000a1";
const businessUserId = "00000000-0000-4000-8000-0000000000b1";
const entityId = "00000000-0000-4000-8000-0000000000e1";
const conversationId = "00000000-0000-4000-8000-0000000000c1";

function build(overrides: Partial<Record<keyof BusinessChatRepository, jest.Mock>> = {}) {
  const repository = {
    findOpenableBusinessUser: jest.fn().mockResolvedValue(businessUserId),
    open: jest.fn().mockResolvedValue({ conversationId, created: true }),
    findLive: jest.fn().mockResolvedValue(conversationId),
    block: jest.fn().mockResolvedValue({ revoked: true }),
    ...overrides,
  };
  const events = { emitConversationRevoked: jest.fn() };
  const service = new BusinessChatService(repository as unknown as BusinessChatRepository, events as unknown as ChatEventsService);
  return { service, repository, events };
}

describe("BusinessChatService (ADR-0023)", () => {
  it("opens with the business account behind a public listing, no social connection involved", async () => {
    const { service, repository } = build();
    await expect(service.open(personId, entityId)).resolves.toEqual({ conversationId, created: true });
    expect(repository.open).toHaveBeenCalledWith(personId, entityId, businessUserId);
  });

  it("answers 404 for a listing that is not public, whatever the reason", async () => {
    const { service, repository } = build({ findOpenableBusinessUser: jest.fn().mockResolvedValue(null) });
    await expect(service.open(personId, entityId)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.open).not.toHaveBeenCalled();
  });

  it("a concurrent opening that lost the unique index returns the winner's conversation", async () => {
    const { service } = build({ open: jest.fn().mockRejectedValue(new UniqueConstraintError({})) });
    await expect(service.open(personId, entityId)).resolves.toEqual({ conversationId, created: false });
  });

  it("other failures are not swallowed", async () => {
    const failure = new Error("boom");
    const { service } = build({ open: jest.fn().mockRejectedValue(failure) });
    await expect(service.open(personId, entityId)).rejects.toBe(failure);
  });

  it("the business blocks only within its own listing; otherwise 404", async () => {
    const { service, repository, events } = build();
    await expect(service.block(conversationId, { userId: businessUserId, entityId })).resolves.toEqual({ conversationId, blocked: true });
    expect(repository.block).toHaveBeenCalledWith(conversationId, entityId, businessUserId);
    expect(events.emitConversationRevoked).toHaveBeenCalledWith(conversationId);

    const foreign = build({ block: jest.fn().mockResolvedValue(null) });
    await expect(foreign.service.block(conversationId, { userId: businessUserId, entityId })).rejects.toBeInstanceOf(NotFoundException);
    const noListing = build();
    await expect(noListing.service.block(conversationId, { userId: businessUserId, entityId: null })).rejects.toBeInstanceOf(NotFoundException);
    expect(noListing.repository.block).not.toHaveBeenCalled();
  });

  it("blocking again keeps the state and emits nothing new", async () => {
    const { service, events } = build({ block: jest.fn().mockResolvedValue({ revoked: false }) });
    await service.block(conversationId, { userId: businessUserId, entityId });
    expect(events.emitConversationRevoked).not.toHaveBeenCalled();
  });
});

describe("business chat rules", () => {
  it("no location and no disappearing messages in a BUSINESS conversation, with stable codes", () => {
    expect(() => assertBusinessMessageAllowed("BUSINESS", "location")).toThrow(expect.objectContaining({ code: "BUSINESS_CHAT_NO_LOCATION" }));
    expect(() => assertBusinessDisappearingAllowed("BUSINESS", 86400)).toThrow(expect.objectContaining({ code: "BUSINESS_CHAT_NO_DISAPPEARING" }));
    expect(() => assertBusinessMessageAllowed("BUSINESS", "text")).not.toThrow();
    expect(() => assertBusinessDisappearingAllowed("BUSINESS", null)).not.toThrow();
    expect(() => assertBusinessMessageAllowed("DIRECT", "location")).not.toThrow();
    expect(() => assertBusinessDisappearingAllowed("DIRECT", 86400)).not.toThrow();
  });

  it("the business never learns when its customer is online", () => {
    const row = {
      conversation_id: conversationId, other_user_id: personId, other_user_name: "Ana", other_user_photo_url: null,
      other_user_last_seen_at: null, last_message_body: null,
    last_message_type: null,
    last_message_from_me: false, last_message_at: null, can_write: true,
      system_kind: null, kind: "BUSINESS", business_entity_id: entityId, viewer_is_business: true, business_closed: false, nickname: null,
      other_last_delivered_at: null, other_last_read_at: null, other_read_receipts_enabled_since: null, disappearing_seconds: null,
    } satisfies ConversationSummaryRow;
    expect(mapConversationSummary(row, true)).toMatchObject({ kind: "BUSINESS", businessEntityId: entityId, otherUserOnline: false });
    expect(mapConversationSummary({ ...row, viewer_is_business: false }, true)).toMatchObject({ otherUserOnline: true, businessClosed: false });
    expect(mapConversationSummary({ ...row, viewer_is_business: false, business_closed: true }, true)).toMatchObject({ businessClosed: true });
  });
});

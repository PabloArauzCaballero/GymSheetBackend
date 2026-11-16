import type { Server } from "socket.io";
import { ChatEventsService } from "./chat-events.service";

describe("ChatEventsService conversation-scoped event payloads", () => {
  it("includes the conversation id while retaining each receipt and revocation field", () => {
    const emitted: Array<[string, Record<string, unknown>]> = [];
    const room = {
      emit: (event: string, payload: Record<string, unknown>) => { emitted.push([event, payload]); },
      socketsLeave: jest.fn(),
    };
    const server = { to: jest.fn(() => room), in: jest.fn(() => room) } as unknown as Server;
    const events = new ChatEventsService();
    events.setServer(server);

    events.emitDelivered("conv-1", { userId: "user-1", deliveredAt: "2026-10-09T00:00:00.000Z" });
    events.emitRead("conv-1", { userId: "user-1", readAt: "2026-10-09T00:01:00.000Z", readFrom: null });
    events.emitReadReceiptSettingsChanged("conv-1", "user-1", 3);
    events.emitConversationRevoked("conv-1");

    expect(emitted).toEqual([
      ["message:delivered", { userId: "user-1", deliveredAt: "2026-10-09T00:00:00.000Z", conversationId: "conv-1" }],
      ["message:read", { userId: "user-1", readAt: "2026-10-09T00:01:00.000Z", readFrom: null, conversationId: "conv-1" }],
      ["read-receipts:changed", { conversationId: "conv-1", userId: "user-1", version: 3 }],
      ["conversation:revoked", { conversationId: "conv-1" }],
    ]);
    expect(room.socketsLeave).toHaveBeenCalledWith("conversation:conv-1");
  });

  it("never tells the other participant who revoked the conversation", () => {
    const emitted: Array<Record<string, unknown>> = [];
    const room = { emit: (_event: string, payload: Record<string, unknown>) => { emitted.push(payload); }, socketsLeave: jest.fn() };
    const events = new ChatEventsService();
    events.setServer({ to: jest.fn(() => room), in: jest.fn(() => room) } as unknown as Server);
    events.emitConversationRevoked("conv-1");
    expect(emitted).toEqual([{ conversationId: "conv-1" }]);
    expect(Object.keys(emitted[0])).not.toContain("byUserId");
  });
});

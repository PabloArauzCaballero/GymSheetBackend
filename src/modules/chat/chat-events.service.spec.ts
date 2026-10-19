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
    events.emitConversationRevoked("conv-1", "user-2");

    expect(emitted).toEqual([
      ["message:delivered", { userId: "user-1", deliveredAt: "2026-10-09T00:00:00.000Z", conversationId: "conv-1" }],
      ["message:read", { userId: "user-1", readAt: "2026-10-09T00:01:00.000Z", readFrom: null, conversationId: "conv-1" }],
      ["read-receipts:changed", { conversationId: "conv-1", userId: "user-1", version: 3 }],
      ["conversation:revoked", { conversationId: "conv-1", byUserId: "user-2" }],
    ]);
    expect(room.socketsLeave).toHaveBeenCalledWith("conversation:conv-1");
  });
});

import type { Socket } from "socket.io";
import { ChatGateway } from "./chat.gateway";

describe("ChatGateway conversation:leave", () => {
  function gateway() {
    return new ChatGateway({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  }

  it("leaves only the requested conversation room for an authenticated socket", async () => {
    const client = {
      data: { userId: "user-1" },
      leave: jest.fn().mockResolvedValue(undefined),
    } as unknown as Socket;

    const conversationId = "00000000-0000-4000-8000-000000000001";
    const result = await gateway().leaveConversation(client, { conversationId });

    expect(result).toEqual({ left: true });
    expect(client.leave).toHaveBeenCalledWith(`conversation:${conversationId}`);
  });

  it("does not leave a room for an unauthenticated socket or malformed payload", async () => {
    const client = {
      data: {},
      leave: jest.fn().mockResolvedValue(undefined),
    } as unknown as Socket;
    const chatGateway = gateway();

    expect(await chatGateway.leaveConversation(client, { conversationId: "00000000-0000-4000-8000-000000000001" })).toEqual({ left: false });
    (client.data as { userId?: string }).userId = "user-1";
    expect(await chatGateway.leaveConversation(client, {})).toEqual({ left: false });
    expect(await chatGateway.leaveConversation(client, { conversationId: "not-a-uuid" })).toEqual({ left: false });
    expect(client.leave).not.toHaveBeenCalled();
  });
});

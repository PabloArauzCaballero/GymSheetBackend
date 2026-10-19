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

describe("ChatGateway authentication gate", () => {
  it("lets a conversation:join sent right after connect wait for the ticket exchange", async () => {
    let redeem: (userId: string) => void = () => undefined;
    const tickets = { consume: jest.fn(() => new Promise<string>((resolve) => { redeem = resolve; })) };
    const users = { findActiveById: jest.fn().mockResolvedValue({ id: "user-1" }) };
    const repository = {
      withActiveConversationLock: jest.fn(async (_id: string, operation: (transaction: unknown) => Promise<boolean>) => operation({})),
      isParticipant: jest.fn().mockResolvedValue(true),
      conversationIdsForUser: jest.fn().mockResolvedValue([]),
    };
    const chatService = { markDelivered: jest.fn().mockResolvedValue(undefined) };
    const presence = { markConnected: jest.fn().mockReturnValue(false) };
    const chatGateway = new ChatGateway(
      tickets as never, users as never, repository as never, chatService as never, {} as never, presence as never,
    );
    const client = {
      id: "socket-1",
      data: {},
      handshake: { auth: { ticket: "t" }, query: {} },
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    } as unknown as Socket;

    const connecting = chatGateway.handleConnection(client);
    const joining = chatGateway.joinConversation(client, { conversationId: "00000000-0000-4000-8000-000000000001" });
    redeem("user-1");
    await connecting;
    await expect(joining).resolves.toEqual({ joined: true });
  });
});

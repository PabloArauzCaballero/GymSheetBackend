import type { Socket } from "socket.io";
import { ChatGateway } from "./chat.gateway";

/** Legal acceptance double: `pending` true means the account still has documents to accept. */
const legal = (pending = false) => ({ hasPending: jest.fn().mockResolvedValue(pending) }) as never;

describe("ChatGateway conversation:leave", () => {
  function gateway() {
    return new ChatGateway({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, legal());
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
      tickets as never, users as never, repository as never, chatService as never, {} as never, presence as never, legal(),
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

describe("ChatGateway message:send", () => {
  it("acks with the stored message so the sender does not wait for message:new", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const clientRequestId = "00000000-0000-4000-8000-0000000000aa";
    const stored = { id: "00000000-0000-4000-8000-000000000010", conversationId, clientRequestId, body: "hola", type: "text" };
    const chatService = { sendMessage: jest.fn().mockResolvedValue(stored) };
    const users = { findActiveById: jest.fn().mockResolvedValue({ id: "user-1", emailVerifiedAt: new Date() }) };
    const chatGateway = new ChatGateway(
      {} as never, users as never, {} as never, chatService as never, {} as never, {} as never, legal(),
    );
    const client = { data: { userId: "user-1", authenticated: Promise.resolve() } } as unknown as Socket;

    await expect(chatGateway.handleMessage(client, { conversationId, body: "hola", clientRequestId })).resolves.toEqual({
      ok: true,
      messageId: stored.id,
      clientRequestId,
      message: stored,
    });
    expect(chatService.sendMessage).toHaveBeenCalledWith(conversationId, "user-1", "hola", clientRequestId, undefined);
  });

  it("refuses to send for an account whose email is not verified", async () => {
    const chatService = { sendMessage: jest.fn() };
    const users = { findActiveById: jest.fn().mockResolvedValue({ id: "user-1", emailVerifiedAt: null }) };
    const chatGateway = new ChatGateway(
      {} as never, users as never, {} as never, chatService as never, {} as never, {} as never, legal(),
    );
    const client = { data: { userId: "user-1", authenticated: Promise.resolve() } } as unknown as Socket;

    await expect(
      chatGateway.handleMessage(client, { conversationId: "00000000-0000-4000-8000-000000000001", body: "hola" }),
    ).resolves.toEqual({ ok: false, error: "email_verification_required" });
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });
});

describe("ChatGateway legal acceptance", () => {
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const client = () => ({ data: { userId: "user-1", authenticated: Promise.resolve() }, join: jest.fn() }) as unknown as Socket;

  it("refuses message:send while the account has documents to accept, before touching the chat", async () => {
    const chatService = { sendMessage: jest.fn() };
    const users = { findActiveById: jest.fn().mockResolvedValue({ id: "user-1", emailVerifiedAt: new Date() }) };
    const chatGateway = new ChatGateway(
      {} as never, users as never, {} as never, chatService as never, {} as never, {} as never, legal(true),
    );
    await expect(chatGateway.handleMessage(client(), { conversationId, body: "hola" })).resolves.toEqual({
      ok: false,
      error: "legal_acceptance_required",
    });
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses conversation:join while the account has documents to accept", async () => {
    const repository = { withActiveConversationLock: jest.fn() };
    const chatGateway = new ChatGateway(
      {} as never, {} as never, repository as never, {} as never, {} as never, {} as never, legal(true),
    );
    const socket = client();
    await expect(chatGateway.joinConversation(socket, { conversationId })).resolves.toEqual({
      joined: false,
      error: "legal_acceptance_required",
    });
    expect(repository.withActiveConversationLock).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });
});

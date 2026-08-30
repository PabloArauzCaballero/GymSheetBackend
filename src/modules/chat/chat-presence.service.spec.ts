import { ChatPresenceService } from "./chat-presence.service";

describe("ChatPresenceService", () => {
  it("is offline until the first socket connects", () => {
    const presence = new ChatPresenceService();
    expect(presence.isOnline("user-1")).toBe(false);
  });

  it("reports the first connection as the transition to online", () => {
    const presence = new ChatPresenceService();
    expect(presence.markConnected("user-1", "socket-a")).toBe(true);
    expect(presence.isOnline("user-1")).toBe(true);
  });

  it("does not re-report online for a second socket of the same account", () => {
    const presence = new ChatPresenceService();
    presence.markConnected("user-1", "socket-a");
    expect(presence.markConnected("user-1", "socket-b")).toBe(false);
  });

  it("stays online while any socket remains open", () => {
    const presence = new ChatPresenceService();
    presence.markConnected("user-1", "socket-a");
    presence.markConnected("user-1", "socket-b");
    expect(presence.markDisconnected("user-1", "socket-a")).toBe(false);
    expect(presence.isOnline("user-1")).toBe(true);
  });

  it("reports the last disconnect as the transition to offline", () => {
    const presence = new ChatPresenceService();
    presence.markConnected("user-1", "socket-a");
    expect(presence.markDisconnected("user-1", "socket-a")).toBe(true);
    expect(presence.isOnline("user-1")).toBe(false);
  });

  it("ignores a disconnect for an account that was never connected", () => {
    const presence = new ChatPresenceService();
    expect(presence.markDisconnected("user-1", "socket-a")).toBe(false);
  });
});

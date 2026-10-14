import { isSocialPairBlocked } from "./social-block.policy";

describe("isSocialPairBlocked", () => {
  it("hides a pair when either person has blocked the other", () => {
    expect(isSocialPairBlocked("alice", "bob", [{ blockerId: "bob", blockedId: "alice" }])).toBe(true);
  });

  it("does not hide unrelated pairs", () => {
    expect(isSocialPairBlocked("alice", "bob", [{ blockerId: "carol", blockedId: "bob" }])).toBe(false);
  });
});

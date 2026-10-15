import { issueDiscoveryCursor, readDiscoveryCursor } from "./discovery-deck.cursor";
import { discoveryDeckQuerySchema } from "./social.schemas";

describe("H4.S4.M3 public discovery cursor budget", () => {
  it("rejects malformed and oversized motor cursors before issuing a public header", () => {
    expect(() => issueDiscoveryCursor(123 as unknown as string, "a".repeat(64))).toThrow();
    expect(() => issueDiscoveryCursor("x".repeat(9_000), "a".repeat(64))).toThrow();
  });

  it("rejects a public cursor too large for the HTTP header budget", () => {
    expect(discoveryDeckQuerySchema.safeParse({ cursor: "x".repeat(12_001) }).success).toBe(false);
  });

  it("keeps 140 pending UUIDs and an 8 KB engine cursor within one signed header", () => {
    const ids = Array.from({ length: 140 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    const engineCursor = "x".repeat(8_000);
    const cursor = issueDiscoveryCursor(engineCursor, "a".repeat(64), ids);
    expect(cursor.length).toBeLessThanOrEqual(12_000);
    expect(readDiscoveryCursor(cursor, "a".repeat(64))).toEqual({ rankingCursor: engineCursor, pendingIds: ids });
  });
});

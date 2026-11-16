import {
  composeDeckPage,
  decodeLocalDeckState,
  encodeLocalDeckState,
  isLocalDeckState,
  type LocalDeckState,
} from "./discovery-ranking.compose";
import type { RankedCandidate } from "./discovery-ranking.repository";
import { DISCOVERY_RANKING_SQL } from "./discovery-ranking.sql";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Rows already ordered by score DESC, as the SQL returns them. */
function rows(spec: { liked?: number[]; fresh?: number[]; count: number }): RankedCandidate[] {
  return Array.from({ length: spec.count }, (_, index) => {
    const n = index + 1;
    return {
      id: uuid(100 - n),
      likedViewer: spec.liked?.includes(n) ?? false,
      isNew: spec.fresh?.includes(n) ?? false,
      distanceKm: 1,
      reasons: [],
      score: (1 - n / 100).toFixed(6),
      activity: 0,
      mutual: 0,
      distance: 0,
      intent: 0,
      affinity: 0,
      verification: 0,
      novelty: 0,
    };
  });
}

const fresh = (asOf = 1_000): LocalDeckState => ({
  asOf,
  version: "v1",
  position: 0,
  key: null,
  pendingLiked: [],
  servedAhead: [],
});

const order = (page: ReturnType<typeof composeDeckPage>) =>
  page.cards.map((card) => 100 - Number(card.candidate.id.slice(-12)));

describe("composeDeckPage", () => {
  it("keeps score order when nobody liked the viewer and nobody is new", () => {
    expect(order(composeDeckPage(rows({ count: 8 }), fresh(), 5, 10))).toEqual([1, 2, 3, 4, 5]);
  });

  it("interleaves liked-you candidates at positions 3–6, never first", () => {
    const page = composeDeckPage(rows({ count: 12, liked: [1, 2, 3, 4, 5] }), fresh(), 8, 0);
    // The top four liked-you cards fill 3–6; the fifth cannot open the deck.
    expect(order(page)).toEqual([6, 7, 1, 2, 3, 4, 5, 8]);
    expect(page.cards.map((card) => card.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("carries liked-you cards owed to positions 3–6 across a page boundary", () => {
    const all = rows({ count: 10, liked: [1, 2] });
    const first = composeDeckPage(all, fresh(), 3, 0);
    expect(order(first)).toEqual([3, 4, 1]);
    expect(first.next?.pendingLiked).toEqual([all[1].id]);
    const key = first.next?.key;
    const rest = all.filter(
      (row) => first.next?.pendingLiked.includes(row.id) || (key && Number(row.score) < Number(key.score)),
    );
    const second = composeDeckPage(rest, first.next as LocalDeckState, 3, 0);
    expect(order(second)).toEqual([2, 5, 6]);
    expect(second.cards[0].position).toBe(4);
  });

  it("reserves every 10th position for an account younger than 7 days", () => {
    const page = composeDeckPage(rows({ count: 30, fresh: [25] }), fresh(), 12, 10);
    expect(order(page)[9]).toBe(25);
    expect(page.next?.servedAhead).toEqual([uuid(75)]);
  });

  it("ends the snapshot when the rows run out", () => {
    const page = composeDeckPage(rows({ count: 2 }), fresh(), 5, 10);
    expect(order(page)).toEqual([1, 2]);
    expect(page.next).toBeNull();
  });
});

describe("local deck state", () => {
  it("round-trips through the cursor encoding", () => {
    const state: LocalDeckState = {
      asOf: 1_794_800_000_000,
      version: "v2-test",
      position: 12,
      key: { score: "0.734512", id: uuid(7) },
      pendingLiked: [uuid(8)],
      servedAhead: [uuid(9), uuid(10)],
    };
    const encoded = encodeLocalDeckState(state);
    expect(isLocalDeckState(encoded)).toBe(true);
    expect(decodeLocalDeckState(encoded)).toEqual(state);
  });

  it("rejects tampered or foreign state", () => {
    expect(isLocalDeckState("remote-cursor")).toBe(false);
    expect(() => decodeLocalDeckState("local1~x~v1~0~~~~")).toThrow("INVALID_LOCAL_CURSOR");
    expect(() => decodeLocalDeckState("local1~1~V1!~1~0.100000~zz~~")).toThrow("INVALID_LOCAL_CURSOR");
  });
});

describe("ranking SQL inputs", () => {
  it("never reads sexual orientation, gamification points or a desirability score", () => {
    expect(DISCOVERY_RANKING_SQL).not.toMatch(/orientation/iu);
    expect(DISCOVERY_RANKING_SQL).not.toMatch(/user_progress|points|elo|desirab/iu);
  });
});

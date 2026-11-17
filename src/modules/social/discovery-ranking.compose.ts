import type { RankedCandidate } from "./discovery-ranking.repository";

/** Deck positions (1-based) that hold candidates who already liked the viewer. */
export const LIKED_YOU_POSITIONS = { first: 3, last: 6 } as const;
/** Upper bound of out-of-order ids a cursor carries (exploration picks). */
export const MAX_SERVED_AHEAD = 40;

/**
 * Pagination state inside one ranking snapshot. The keyset `(score, id)` is the
 * last card served in score order; `servedAhead` are cards pulled forward from
 * below it (exploration) and `pendingLiked` the liked-you cards still owed to
 * positions 3–6, which may score above the keyset.
 */
export interface LocalDeckState {
  asOf: number;
  version: string;
  position: number;
  key: { score: string; id: string } | null;
  pendingLiked: string[];
  servedAhead: string[];
}

export interface ComposedPage {
  cards: { candidate: RankedCandidate; position: number }[];
  next: LocalDeckState | null;
}

/**
 * Builds one page from rows already ordered by `score DESC, id DESC`:
 * - liked-you candidates go to positions 3–6 (never forced first);
 * - every `explorationEvery`-th position goes to the best account younger
 *   than 7 days, when there is one;
 * - every other position takes the next row in score order.
 */
export function composeDeckPage(
  rows: readonly RankedCandidate[],
  state: LocalDeckState,
  limit: number,
  explorationEvery: number,
): ComposedPage {
  const firstPage = state.position === 0;
  const likedQueue = firstPage
    ? rows.filter((row) => row.likedViewer).slice(0, LIKED_YOU_POSITIONS.last - LIKED_YOU_POSITIONS.first + 1)
    : state.pendingLiked.flatMap((id) => rows.filter((row) => row.id === id));
  const likedIds = new Set(likedQueue.map((row) => row.id));
  const main = rows.filter((row) => !likedIds.has(row.id));
  const taken = new Set<string>();
  const servedAhead = [...state.servedAhead];
  const cards: ComposedPage["cards"] = [];
  let key = state.key;
  let head = 0;

  const advanceHead = () => {
    while (head < main.length && taken.has(main[head].id)) head += 1;
  };
  const takeMain = (index: number) => {
    const row = main[index];
    taken.add(row.id);
    if (index === head) key = { score: row.score, id: row.id };
    else servedAhead.push(row.id);
    return row;
  };

  for (let position = state.position + 1; cards.length < limit; position += 1) {
    advanceHead();
    let picked: RankedCandidate | undefined;
    const likedSlot = position >= LIKED_YOU_POSITIONS.first && position <= LIKED_YOU_POSITIONS.last;
    if (likedQueue.length && (likedSlot || head >= main.length || position > LIKED_YOU_POSITIONS.last)) {
      picked = likedQueue.shift();
    } else if (
      explorationEvery > 0 &&
      position % explorationEvery === 0 &&
      servedAhead.length < MAX_SERVED_AHEAD
    ) {
      const index = main.findIndex((row, at) => at >= head && row.isNew && !taken.has(row.id));
      if (index >= 0) picked = takeMain(index);
    } else if (position < LIKED_YOU_POSITIONS.first) {
      // A liked-you card beyond the fourth must not open the deck either.
      const index = main.findIndex((row, at) => at >= head && !row.likedViewer && !taken.has(row.id));
      if (index >= 0) picked = takeMain(index);
    }
    if (!picked && head < main.length) picked = takeMain(head);
    if (!picked) break;
    cards.push({ candidate: picked, position });
  }

  advanceHead();
  const remainingMain = main.slice(head).some((row) => !taken.has(row.id));
  if (!remainingMain && !likedQueue.length) return { cards, next: null };
  const finalKey = key;
  return {
    cards,
    next: {
      asOf: state.asOf,
      version: state.version,
      position: state.position + cards.length,
      key: finalKey,
      pendingLiked: likedQueue.map((row) => row.id),
      // Ids at or above the keyset are already excluded by it.
      servedAhead: finalKey ? servedAhead.filter((id) => belowKey(rows, id, finalKey)) : servedAhead,
    },
  };
}

function belowKey(
  rows: readonly RankedCandidate[],
  id: string,
  key: { score: string; id: string },
): boolean {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) return true;
  const difference = Number(row.score) - Number(key.score);
  return difference < 0 || (difference === 0 && row.id < key.id);
}

const LOCAL_PREFIX = "local1";
const HEX_ID = /^[0-9a-f]{32}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,31}$/u;
const SCORE = /^-?\d{1,4}\.\d{6}$/u;

const packId = (id: string) => id.replace(/-/gu, "");
const unpackId = (hex: string) => {
  if (!HEX_ID.test(hex)) throw new Error("INVALID_LOCAL_CURSOR");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const packList = (ids: readonly string[]) => ids.map(packId).join(",");
const unpackList = (text: string) => (text ? text.split(",").map(unpackId) : []);

/** ASCII state carried inside the signed public cursor (`discovery-deck.cursor.ts`). */
export function encodeLocalDeckState(state: LocalDeckState): string {
  return [
    LOCAL_PREFIX,
    state.asOf.toString(36),
    state.version,
    state.position.toString(36),
    state.key?.score ?? "",
    state.key ? packId(state.key.id) : "",
    packList(state.pendingLiked),
    packList(state.servedAhead),
  ].join("~");
}

export function isLocalDeckState(rankingCursor: string | null): boolean {
  return !!rankingCursor && rankingCursor.startsWith(`${LOCAL_PREFIX}~`);
}

export function decodeLocalDeckState(text: string): LocalDeckState {
  const parts = text.split("~");
  if (parts.length !== 8 || parts[0] !== LOCAL_PREFIX) throw new Error("INVALID_LOCAL_CURSOR");
  const [, asOf, version, position, score, keyId, pendingLiked, servedAhead] = parts;
  const state: LocalDeckState = {
    asOf: Number.parseInt(asOf, 36),
    version,
    position: Number.parseInt(position, 36),
    key: score || keyId ? { score, id: unpackId(keyId) } : null,
    pendingLiked: unpackList(pendingLiked),
    servedAhead: unpackList(servedAhead),
  };
  if (
    !Number.isSafeInteger(state.asOf) ||
    !Number.isSafeInteger(state.position) ||
    state.position < 1 ||
    !VERSION.test(version) ||
    (state.key !== null && !SCORE.test(state.key.score)) ||
    state.pendingLiked.length > LIKED_YOU_POSITIONS.last ||
    state.servedAhead.length > MAX_SERVED_AHEAD
  ) {
    throw new Error("INVALID_LOCAL_CURSOR");
  }
  return state;
}

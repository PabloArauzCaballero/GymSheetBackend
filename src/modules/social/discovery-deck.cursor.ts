import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";

export const MAX_PUBLIC_DISCOVERY_CURSOR = 12_000;
const MAX_RANKING_CURSOR = 8_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface DiscoveryCursorState {
  rankingCursor: string | null;
  pendingIds: string[];
}

/** Binds the ranker's opaque cursor to the exact backend authorization context. */
export function discoveryCursorContext(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function signature(payload: string): string {
  return createHmac("sha256", env.JWT_ACCESS_SECRET).update(payload).digest("base64url");
}

function packIds(ids: string[]): string {
  if (ids.every((id) => UUID_PATTERN.test(id))) {
    const bytes = Buffer.concat(ids.map((id) => Buffer.from(id.replace(/-/gu, ""), "hex")));
    return `u${bytes.toString("base64url")}`;
  }
  return `j${Buffer.from(JSON.stringify(ids)).toString("base64url")}`;
}

function unpackIds(packed: string): string[] {
  const bytes = Buffer.from(packed.slice(1), "base64url");
  if (bytes.toString("base64url") !== packed.slice(1)) throw new Error();
  if (packed[0] === "u") {
    if (bytes.length % 16 !== 0) throw new Error();
    const ids: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const hex = bytes.subarray(offset, offset + 16).toString("hex");
      ids.push(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
    }
    return ids;
  }
  if (packed[0] === "j") return JSON.parse(bytes.toString("utf8")) as string[];
  throw new Error();
}

function validState(rankingCursor: unknown, pendingIds: unknown): pendingIds is string[] {
  return (rankingCursor === null || (typeof rankingCursor === "string" && !!rankingCursor && rankingCursor.length <= MAX_RANKING_CURSOR)) &&
    Array.isArray(pendingIds) && pendingIds.length <= 150 &&
    pendingIds.every((id) => typeof id === "string" && !!id && id.length <= 200) &&
    new Set(pendingIds).size === pendingIds.length && (!!rankingCursor || pendingIds.length > 0);
}

/** The motor cursor stays as ASCII; UUIDs are packed into 16 bytes each. */
export function issueDiscoveryCursor(rankingCursor: string | null, context: string, pendingIds: string[] = []): string {
  if (!validState(rankingCursor, pendingIds) || !/^[0-9a-f]{64}$/u.test(context)) {
    throw new Error("INVALID_DISCOVERY_CURSOR");
  }
  const rawCursor = rankingCursor ?? "";
  const payload = `2.${context}.${rawCursor.length.toString(36)}.${rawCursor}.${packIds(pendingIds)}`;
  const cursor = `${payload}.${signature(payload)}`;
  if (cursor.length > MAX_PUBLIC_DISCOVERY_CURSOR) throw new Error("INVALID_DISCOVERY_CURSOR");
  return cursor;
}

export function readDiscoveryCursor(cursor: string, context: string): DiscoveryCursorState {
  try {
    if (typeof cursor !== "string" || cursor.length > MAX_PUBLIC_DISCOVERY_CURSOR || !cursor.startsWith("2.")) throw new Error();
    const contextEnd = cursor.indexOf(".", 2);
    const lengthEnd = cursor.indexOf(".", contextEnd + 1);
    if (contextEnd < 0 || lengthEnd < 0 || cursor.slice(2, contextEnd) !== context) throw new Error();
    const lengthText = cursor.slice(contextEnd + 1, lengthEnd);
    if (!/^[0-9a-z]{1,4}$/u.test(lengthText)) throw new Error();
    const rankingLength = Number.parseInt(lengthText, 36);
    if (rankingLength > MAX_RANKING_CURSOR || rankingLength.toString(36) !== lengthText) throw new Error();
    const rankingStart = lengthEnd + 1;
    const rankingEnd = rankingStart + rankingLength;
    if (cursor[rankingEnd] !== ".") throw new Error();
    const signatureStart = cursor.lastIndexOf(".");
    if (signatureStart <= rankingEnd || !/^[A-Za-z0-9_-]{43}$/u.test(cursor.slice(signatureStart + 1))) throw new Error();
    const payload = cursor.slice(0, signatureStart);
    const expected = Buffer.from(signature(payload), "base64url");
    const supplied = Buffer.from(cursor.slice(signatureStart + 1), "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
    const pendingIds = unpackIds(cursor.slice(rankingEnd + 1, signatureStart));
    const rankingCursor = rankingLength ? cursor.slice(rankingStart, rankingEnd) : null;
    if (!validState(rankingCursor, pendingIds)) throw new Error();
    return { rankingCursor, pendingIds };
  } catch {
    throw new Error("INVALID_DISCOVERY_CURSOR");
  }
}

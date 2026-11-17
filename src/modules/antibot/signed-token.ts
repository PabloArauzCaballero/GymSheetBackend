import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Identity and issue time recovered from a token whose signature checked out. */
export type SignedTokenClaims = { id: string; issuedAt: Date };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ticketPayloadSchema = z.object({ id: z.string().regex(UUID_PATTERN), iat: z.number().int().positive() });

// Domain separation: a form ticket must never verify as an attestation nonce,
// and the other way round, even though both share one secret.
const TICKET_DOMAIN = "signup-ticket.v1.";
const NONCE_DOMAIN = Buffer.from("attestation-nonce.v1.");
const NONCE_ID_BYTES = 16;
const NONCE_TIME_BYTES = 8;
const MAC_BYTES = 32;

function mac(secret: string, ...parts: (string | Buffer)[]): Buffer {
  const hmac = createHmac("sha256", secret);
  for (const part of parts) hmac.update(part);
  return hmac.digest();
}

function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `base64url(payload).base64url(HMAC-SHA256)`, payload `{id, iat}`. */
export function signTicket(secret: string, claims: SignedTokenClaims): string {
  const payload = Buffer.from(
    JSON.stringify({ id: claims.id, iat: claims.issuedAt.getTime() }),
  ).toString("base64url");
  return `${payload}.${mac(secret, TICKET_DOMAIN, payload).toString("base64url")}`;
}

/** Null on any malformed or forged ticket; expiry is the caller's rule. */
export function readTicket(secret: string, ticket: string): SignedTokenClaims | null {
  if (ticket.length > 512) return null;
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!sameBytes(Buffer.from(signature, "base64url"), mac(secret, TICKET_DOMAIN, payload))) {
    return null;
  }
  try {
    const parsed = ticketPayloadSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.success ? { id: parsed.data.id, issuedAt: new Date(parsed.data.iat) } : null;
  } catch {
    return null;
  }
}

/**
 * Attestation nonce: `base64url(id ‖ issuedAtMs ‖ HMAC)` with no separator,
 * because Play Integrity only accepts web-safe base64 (no `.`) of 16–500 chars.
 */
export function signNonce(secret: string, claims: SignedTokenClaims): string {
  const id = Buffer.from(claims.id.replace(/-/g, ""), "hex");
  const time = Buffer.alloc(NONCE_TIME_BYTES);
  time.writeBigUInt64BE(BigInt(claims.issuedAt.getTime()));
  return Buffer.concat([id, time, mac(secret, NONCE_DOMAIN, id, time)]).toString("base64url");
}

export function readNonce(secret: string, nonce: string): SignedTokenClaims | null {
  if (nonce.length > 128 || !/^[\w-]+$/.test(nonce)) return null;
  const raw = Buffer.from(nonce, "base64url");
  if (raw.length !== NONCE_ID_BYTES + NONCE_TIME_BYTES + MAC_BYTES) return null;
  const id = raw.subarray(0, NONCE_ID_BYTES);
  const time = raw.subarray(NONCE_ID_BYTES, NONCE_ID_BYTES + NONCE_TIME_BYTES);
  if (!sameBytes(raw.subarray(NONCE_ID_BYTES + NONCE_TIME_BYTES), mac(secret, NONCE_DOMAIN, id, time))) {
    return null;
  }
  const hex = id.toString("hex");
  return {
    id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    issuedAt: new Date(Number(time.readBigUInt64BE())),
  };
}

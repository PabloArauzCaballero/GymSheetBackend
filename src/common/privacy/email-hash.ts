import { createHmac } from "node:crypto";
import { env } from "../../config/env";

/**
 * HMAC-SHA256 of a normalized email, keyed with the privacy pepper
 * `IP_HASH_SECRET` (the same secret keys IP and email hashes; ADR-0015).
 * The `email:` prefix separates the two domains, so an email hash can never
 * equal an IP hash. Returns null without a secret: an unkeyed hash of an email
 * is reversible by dictionary, so nothing is stored instead.
 */
export function hashEmail(
  email: string | null | undefined,
  secret: string | null | undefined = env.IP_HASH_SECRET,
): string | null {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !secret) return null;
  return createHmac("sha256", secret).update(`email:${normalized}`).digest("hex");
}

import { createHmac } from "node:crypto";
import { env } from "../../config/env";

/** Days a keyed IP hash may be kept before retention nulls it (ADR-0014). */
export const IP_HASH_RETENTION_DAYS = 90;

/**
 * HMAC-SHA256 of a client IP keyed with `IP_HASH_SECRET`. The raw IP is never
 * stored: the hash still lets an investigation confirm "same address" while
 * the table stops being a log of personal data. Returns null when there is no
 * IP or no secret, so an unconfigured deployment stores no IP evidence at all.
 */
export function hashClientIp(
  ip: string | null | undefined,
  secret: string | null | undefined = env.IP_HASH_SECRET,
): string | null {
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

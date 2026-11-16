import { createHmac } from "node:crypto";
import { env } from "../../config/env";

const GMAIL_DOMAINS: ReadonlySet<string> = new Set(["gmail.com", "googlemail.com"]);

/**
 * One canonical form per mailbox, so the aliases of an address hash alike:
 * lowercase, `+suffix` subaddressing dropped from the local part, and for
 * Gmail (whose two domains are one mailbox and which ignores dots) the dots
 * removed and the domain unified. Only used for hashing, never to send mail.
 */
export function canonicalEmail(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf("@");
  if (at <= 0) return lowered;
  const domain = lowered.slice(at + 1);
  let local = lowered.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (!GMAIL_DOMAINS.has(domain)) return `${local}@${domain}`;
  return `${local.replace(/\./gu, "")}@gmail.com`;
}

/**
 * HMAC-SHA256 of the canonical email (`canonicalEmail`), keyed with the privacy pepper
 * `IP_HASH_SECRET` (the same secret keys IP and email hashes; ADR-0015).
 * The `email:` prefix separates the two domains, so an email hash can never
 * equal an IP hash. Returns null without a secret: an unkeyed hash of an email
 * is reversible by dictionary, so nothing is stored instead.
 */
export function hashEmail(
  email: string | null | undefined,
  secret: string | null | undefined = env.IP_HASH_SECRET,
): string | null {
  const trimmed = email?.trim();
  if (!trimmed || !secret) return null;
  const normalized = canonicalEmail(trimmed);
  return createHmac("sha256", secret).update(`email:${normalized}`).digest("hex");
}

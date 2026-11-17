import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";

// Domain separation: this MAC must never verify anything else signed with the same secret.
const DOMAIN = "gymsheet:verification-selfie-link:v1\0";

function mac(secret: string, verificationId: string, viewerId: string, expiresAtMs: number): Buffer {
  return createHmac("sha256", secret)
    .update(DOMAIN)
    .update(`${verificationId}\0${viewerId}\0${expiresAtMs}`)
    .digest();
}

/**
 * Short-lived link to a selfie for one moderator. It is bound to the
 * verification, to the viewer and to an expiry; the route still requires the
 * viewer's session and moderation permission, so a leaked link alone is useless.
 */
export class SelfieLinkSigner {
  constructor(private readonly secret: string = env.JWT_ACCESS_SECRET) {}

  sign(verificationId: string, viewerId: string, expiresAt: Date): string {
    return mac(this.secret, verificationId, viewerId, expiresAt.getTime()).toString("base64url");
  }

  isValid(
    verificationId: string,
    viewerId: string,
    expiresAtMs: number,
    signature: string,
    now: Date,
  ): boolean {
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now.getTime()) return false;
    const expected = mac(this.secret, verificationId, viewerId, expiresAtMs);
    const received = Buffer.from(signature, "base64url");
    return received.length === expected.length && timingSafeEqual(received, expected);
  }
}

import { HttpStatus } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { canonicalEmail } from "../../common/privacy/email-hash";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";

const MAGIC = Buffer.from("GSKY1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

function kycUnavailable(): DomainException {
  return new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "KYC_UNAVAILABLE", "La verificación de negocios no está disponible en este momento.");
}

/**
 * AES-256-GCM for KYC data and documents (ADR-0021). Same container format as
 * `ChatMediaCipher` (magic, IV, tag, data) with its own domain and its own key
 * `KYC_ENCRYPTION_KEY`, read at call time and never replaced by another
 * secret: without it nothing is encrypted and the KYC answers 503
 * `KYC_UNAVAILABLE` (production refuses to boot without it, `env.ts`).
 */
export class KycCipher {
  constructor(private readonly secret: () => string | undefined = () => env.KYC_ENCRYPTION_KEY) {}

  /** Whether the KYC can run: the cipher key and the privacy pepper are both configured. */
  available(): boolean {
    return Boolean(this.secret()) && Boolean(env.IP_HASH_SECRET);
  }

  encrypt(plain: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
  }

  decrypt(payload: Buffer): Buffer {
    const dataStart = MAGIC.length + IV_BYTES + TAG_BYTES;
    if (payload.length < dataStart || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("The KYC payload is not in the encrypted format.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key(), payload.subarray(MAGIC.length, MAGIC.length + IV_BYTES));
    decipher.setAuthTag(payload.subarray(MAGIC.length + IV_BYTES, dataStart));
    return Buffer.concat([decipher.update(payload.subarray(dataStart)), decipher.final()]);
  }

  encryptText(value: string): Buffer {
    return this.encrypt(Buffer.from(value, "utf8"));
  }

  decryptText(payload: Buffer): string {
    return this.decrypt(payload).toString("utf8");
  }

  private key(): Buffer {
    const secret = this.secret();
    if (!secret) throw kycUnavailable();
    return createHash("sha256").update("gymsheet:kyc:v1\0", "utf8").update(secret, "utf8").digest();
  }
}

export type FingerprintKind = "NIT" | "CI" | "PHONE" | "EMAIL";

const DOMAIN_PREFIX: Record<FingerprintKind, string> = { NIT: "nit:", CI: "ci:", PHONE: "phone:", EMAIL: "email:" };

/**
 * Keyed HMAC of an identity datum with the privacy pepper (`IP_HASH_SECRET`),
 * one domain prefix per kind so a NIT never equals a CI. The EMAIL kind is
 * exactly `hashEmail` (canonical mailbox), so it matches the closed-account
 * sanctions. Without the pepper the KYC is unavailable (503): an unkeyed hash
 * of a CI is reversible by enumeration.
 */
export function kycFingerprint(kind: FingerprintKind, value: string, secret: string | null | undefined = env.IP_HASH_SECRET): string {
  if (!secret) throw kycUnavailable();
  const normalized = kind === "EMAIL" ? canonicalEmail(value) : value.trim().toUpperCase();
  return createHmac("sha256", secret).update(`${DOMAIN_PREFIX[kind]}${normalized}`).digest("hex");
}

export function assertKycAvailable(cipher: KycCipher): void {
  if (!cipher.available()) throw kycUnavailable();
}

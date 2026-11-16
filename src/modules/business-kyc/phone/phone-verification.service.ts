import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { DomainException } from "../../../common/errors/domain.exception";
import { KYC_CLOCK, KycClock } from "../kyc-pipeline.service";
import { KycCipher, assertKycAvailable, kycFingerprint } from "../kyc-cipher";
import { maskTail, normalizeBolivianMobile } from "../kyc-formats";
import { PHONE_OTP_SENDER, PhoneOtpSender } from "./phone-otp.port";

export const PHONE_OTP_RULES = {
  codeTtlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  resendCooldownMs: 60 * 1000,
  maxRequestsPerHour: 5,
} as const;

type VerificationRow = {
  id: string;
  phoneMasked: string;
  phoneHmac: string;
  phoneEnc: Buffer;
  codeHash: string | null;
  attempts: number;
  expiresAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
};

export type PhoneState = { phoneMasked: string; verified: boolean; verifiedAt: string | null } | null;
export type PhoneRequestResult = { phoneMasked: string; codeSent: boolean; expiresAt: string | null };

const COLUMNS = `id, phone_masked AS "phoneMasked", phone_hmac AS "phoneHmac", phone_enc AS "phoneEnc", code_hash AS "codeHash",
  attempts, expires_at AS "expiresAt", verified_at AS "verifiedAt", created_at AS "createdAt"`;

function codeHash(verificationId: string, code: string): string {
  return createHash("sha256").update(`${verificationId}:${code}`).digest("hex");
}

/**
 * Phone of a business, proven by a 6-digit code sent by WhatsApp (ADR-0021).
 * The phone is stored encrypted plus its HMAC; the code only as a hash salted
 * with the row id, valid 10 minutes and 5 attempts. Requesting never says
 * whether another account uses the number (that is the DUPLICATE_PHONE check
 * of the submit, seen by REPP only).
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly cipher: KycCipher,
    @Inject(PHONE_OTP_SENDER) private readonly sender: PhoneOtpSender,
    @Inject(KYC_CLOCK) private readonly clock: KycClock,
  ) {}

  async request(accountId: string, input: string): Promise<PhoneRequestResult> {
    assertKycAvailable(this.cipher);
    const phone = normalizeBolivianMobile(input);
    if (!phone) {
      throw new DomainException(HttpStatus.BAD_REQUEST, "PHONE_INVALID", "Escribe un celular de Bolivia: 8 dígitos que empiezan con 6 o 7.");
    }
    const now = this.clock();
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = this.sender.available ? new Date(now.getTime() + PHONE_OTP_RULES.codeTtlMs) : null;
    const phoneMasked = `+591 ${maskTail(phone.slice(4))}`;
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))", {
        replacements: { key: `phone-otp:${accountId}` },
        transaction,
      });
      await this.assertNotTooOften(accountId, now, transaction);
      await this.sequelize.query(
        `INSERT INTO business.phone_verifications (id, account_id, phone_hmac, phone_enc, phone_masked, code_hash, expires_at, created_at)
         VALUES (:id, :accountId, :phoneHmac, :phoneEnc, :phoneMasked, :codeHash, :expiresAt, :now)`,
        {
          replacements: {
            id,
            accountId,
            phoneHmac: kycFingerprint("PHONE", phone),
            phoneEnc: this.cipher.encryptText(phone),
            phoneMasked,
            codeHash: this.sender.available ? codeHash(id, code) : null,
            expiresAt,
            now,
          },
          transaction,
        },
      );
    });
    if (!this.sender.available) return { phoneMasked, codeSent: false, expiresAt: null };
    const delivery = await this.sender.send(phone, code);
    if (!delivery.delivered) {
      this.logger.warn({ event: "phone_otp.not_delivered", provider: this.sender.name, reason: delivery.reason });
      throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "PHONE_OTP_UNAVAILABLE", "No pudimos enviarte el código. Inténtalo en unos minutos.");
    }
    return { phoneMasked, codeSent: true, expiresAt: expiresAt?.toISOString() ?? null };
  }

  async confirm(accountId: string, code: string): Promise<PhoneState> {
    const now = this.clock();
    const outcome = await this.sequelize.transaction(async (transaction) => {
      const row = await this.latest(accountId, transaction, true);
      if (!row?.codeHash || row.verifiedAt) {
        if (!this.sender.available) {
          throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "PHONE_OTP_UNAVAILABLE", "La verificación por WhatsApp no está disponible todavía.");
        }
        throw new DomainException(HttpStatus.CONFLICT, "PHONE_OTP_NOT_REQUESTED", "Primero pide un código para tu celular.");
      }
      if (row.attempts >= PHONE_OTP_RULES.maxAttempts) {
        throw new DomainException(HttpStatus.TOO_MANY_REQUESTS, "PHONE_OTP_EXHAUSTED", "Agotaste los intentos. Pide un código nuevo.");
      }
      if (!row.expiresAt || row.expiresAt <= now) {
        throw new DomainException(HttpStatus.GONE, "PHONE_OTP_EXPIRED", "El código venció. Pide uno nuevo.");
      }
      const matches = timingSafeEqual(Buffer.from(row.codeHash, "hex"), Buffer.from(codeHash(row.id, code), "hex"));
      await this.sequelize.query(
        `UPDATE business.phone_verifications SET attempts = attempts + 1${matches ? ", verified_at = :now" : ""} WHERE id = :id`,
        { replacements: { id: row.id, now }, transaction },
      );
      return { matches, attemptsLeft: PHONE_OTP_RULES.maxAttempts - row.attempts - 1, row };
    });
    if (!outcome.matches) {
      throw new DomainException(HttpStatus.BAD_REQUEST, "PHONE_OTP_INVALID", "El código no es correcto.", {
        attemptsLeft: outcome.attemptsLeft,
      });
    }
    return { phoneMasked: outcome.row.phoneMasked, verified: true, verifiedAt: now.toISOString() };
  }

  async state(accountId: string): Promise<PhoneState> {
    const row = await this.latest(accountId);
    return row ? { phoneMasked: row.phoneMasked, verified: Boolean(row.verifiedAt), verifiedAt: row.verifiedAt?.toISOString() ?? null } : null;
  }

  /** The phone the submit takes: the latest one given, verified or not. */
  async latestForSubmit(
    accountId: string,
    transaction: Transaction,
  ): Promise<{ phoneHmac: string; phoneEnc: Buffer; phoneMasked: string; verifiedAt: Date | null } | null> {
    return this.latest(accountId, transaction);
  }

  private async latest(accountId: string, transaction?: Transaction, lock = false): Promise<VerificationRow | null> {
    const [row] = await this.sequelize.query<VerificationRow>(
      `SELECT ${COLUMNS} FROM business.phone_verifications WHERE account_id = :accountId
        ORDER BY created_at DESC, id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      { type: QueryTypes.SELECT, replacements: { accountId }, transaction },
    );
    return row ?? null;
  }

  private async assertNotTooOften(accountId: string, now: Date, transaction: Transaction): Promise<void> {
    const rows = await this.sequelize.query<{ createdAt: Date }>(
      `SELECT created_at AS "createdAt" FROM business.phone_verifications
        WHERE account_id = :accountId AND created_at > :since ORDER BY created_at DESC`,
      { type: QueryTypes.SELECT, replacements: { accountId, since: new Date(now.getTime() - 60 * 60 * 1000) }, transaction },
    );
    const last = rows[0]?.createdAt;
    const cooldownUntil = last ? new Date(last.getTime() + PHONE_OTP_RULES.resendCooldownMs) : null;
    const hourlyUntil =
      rows.length >= PHONE_OTP_RULES.maxRequestsPerHour ? new Date(rows[rows.length - 1].createdAt.getTime() + 60 * 60 * 1000) : null;
    const retryAt = [cooldownUntil, hourlyUntil].filter((at): at is Date => at !== null && at > now).sort((a, b) => b.getTime() - a.getTime())[0];
    if (retryAt) {
      throw new DomainException(HttpStatus.TOO_MANY_REQUESTS, "PHONE_OTP_RATE_LIMITED", "Espera un momento antes de pedir otro código.", {
        retryAt: retryAt.toISOString(),
      });
    }
  }
}

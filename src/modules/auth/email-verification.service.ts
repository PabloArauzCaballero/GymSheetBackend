import { HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";
import { NotificationService } from "../notifications/notification.service";
import { UsersRepository } from "../users/users.repository";
import { EmailVerificationPinRepository } from "./email-verification-pin.repository";

/** Same shape as the password-reset PIN; these are product decisions, not tuning knobs. */
export const EMAIL_PIN_POLICY = {
  ttlMinutes: 10,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxSendsPerDay: 5,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

type ConfirmOutcome =
  | { kind: "VERIFIED" }
  | { kind: "INVALID"; attemptsRemaining: number | null }
  | { kind: "EXPIRED" }
  | { kind: "EXHAUSTED" };

/**
 * Proves that the person owns the mailbox of the account with a 6-digit PIN.
 *
 * Unlike password reset, both endpoints are authenticated: the PIN is bound to
 * the session's account, so the errors may say precisely what went wrong
 * (expired, exhausted, cooldown) without turning anything into an oracle.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly pins: EmailVerificationPinRepository,
    private readonly users: UsersRepository,
    private readonly notifications: NotificationService,
    private readonly sequelize: Sequelize,
  ) {}

  /** Sends a new PIN unless the mailbox is already verified (then a silent no-op). */
  async requestPin(userId: string): Promise<void> {
    const user = await this.users.findActiveById(userId);
    if (!user) throw new UnauthorizedException("La sesión ya no es válida.");
    if (user.emailVerifiedAt) return;
    await this.sequelize.transaction((transaction) => this.issuePin(user.id, transaction));
  }

  /**
   * Issues a PIN and enqueues its email in the caller's transaction (signup
   * calls this inside the account creation). The account row is locked so two
   * concurrent requests cannot both slip past the cooldown.
   */
  async issuePin(userId: string, transaction: Transaction): Promise<void> {
    await this.users.lockUserForUpdate(userId, transaction);
    const now = Date.now();
    const window = await this.pins.sendWindow(userId, new Date(now - DAY_MS), transaction);
    const cooldownEndsAt = (window.latest?.getTime() ?? 0) + EMAIL_PIN_POLICY.resendCooldownSeconds * 1000;
    if (cooldownEndsAt > now) throw cooldown(cooldownEndsAt - now);
    if (window.sent >= EMAIL_PIN_POLICY.maxSendsPerDay && window.oldest) {
      throw cooldown(window.oldest.getTime() + DAY_MS - now);
    }

    // `randomInt`, not `Math.random()`: this is a credential.
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const pinHash = await bcrypt.hash(pin, env.BCRYPT_SALT_ROUNDS);
    const expiresAt = new Date(now + EMAIL_PIN_POLICY.ttlMinutes * 60_000);
    await this.pins.supersedePending(userId, transaction);
    await this.pins.insert(userId, pinHash, expiresAt, transaction);
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: userId,
        channel: NotificationChannel.EMAIL,
        subject: "Confirma tu correo en GymSheet",
        body: [
          `Tu código para confirmar el correo es ${pin}`,
          "",
          `Caduca en ${EMAIL_PIN_POLICY.ttlMinutes} minutos y sólo sirve una vez.`,
          "",
          "Si no creaste una cuenta en GymSheet, ignora este mensaje.",
        ].join("\n"),
        deduplicationKey: `email-verification-${userId}-${expiresAt.getTime()}`,
      },
      transaction,
    );
  }

  async confirm(userId: string, pin: string): Promise<{ verified: true }> {
    // The outcome is decided inside the transaction and thrown after commit:
    // throwing inside would roll back the attempt counter it just raised.
    const outcome = await this.sequelize.transaction((transaction) =>
      this.checkPin(userId, pin, transaction),
    );
    if (outcome.kind === "VERIFIED") return { verified: true };
    throw pinError(outcome);
  }

  private async checkPin(userId: string, pin: string, transaction: Transaction): Promise<ConfirmOutcome> {
    const user = await this.users.findActiveById(userId, transaction);
    if (!user) throw new UnauthorizedException("La sesión ya no es válida.");
    if (user.emailVerifiedAt) return { kind: "VERIFIED" };

    const latest = await this.pins.findLatestForUpdate(userId, transaction);
    if (!latest) return { kind: "INVALID", attemptsRemaining: null };
    if (latest.attempts >= EMAIL_PIN_POLICY.maxAttempts) return { kind: "EXHAUSTED" };
    if (latest.consumedAt) return { kind: "INVALID", attemptsRemaining: null };
    if (new Date(latest.expiresAt).getTime() <= Date.now()) return { kind: "EXPIRED" };

    if (!(await bcrypt.compare(pin, latest.pinHash))) {
      const attempts = latest.attempts + 1;
      const exhausted = attempts >= EMAIL_PIN_POLICY.maxAttempts;
      await this.pins.recordFailedAttempt(latest.id, exhausted, transaction);
      return exhausted
        ? { kind: "EXHAUSTED" }
        : { kind: "INVALID", attemptsRemaining: EMAIL_PIN_POLICY.maxAttempts - attempts };
    }

    await this.pins.consume(latest.id, transaction);
    await this.users.markEmailVerified(userId, transaction);
    return { kind: "VERIFIED" };
  }
}

function cooldown(remainingMs: number): DomainException {
  const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return new DomainException(
    HttpStatus.TOO_MANY_REQUESTS,
    "EMAIL_PIN_COOLDOWN",
    "Espera un momento antes de pedir otro código.",
    { retryAfterSeconds },
  );
}

function pinError(outcome: Exclude<ConfirmOutcome, { kind: "VERIFIED" }>): DomainException {
  switch (outcome.kind) {
    case "EXPIRED":
      return new DomainException(
        HttpStatus.BAD_REQUEST,
        "EMAIL_PIN_EXPIRED",
        "El código caducó. Pide uno nuevo.",
      );
    case "EXHAUSTED":
      return new DomainException(
        HttpStatus.BAD_REQUEST,
        "EMAIL_PIN_EXHAUSTED",
        "Demasiados intentos con este código. Pide uno nuevo.",
      );
    case "INVALID":
      return new DomainException(
        HttpStatus.BAD_REQUEST,
        "EMAIL_PIN_INVALID",
        "El código no es correcto.",
        outcome.attemptsRemaining === null ? undefined : { attemptsRemaining: outcome.attemptsRemaining },
      );
  }
}

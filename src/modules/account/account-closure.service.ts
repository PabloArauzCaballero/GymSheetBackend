import { HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Transaction } from "sequelize";
import { UserRole } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";
import { EMAIL_PIN_POLICY, EmailPinFailure, EmailVerificationService, emailPinError } from "../auth/email-verification.service";
import { OutboxService } from "../integration/outbox.service";
import { SocialRecommendationOutboxService } from "../social/social-recommendation-outbox.service";
import { UserModel } from "../users/user.model";
import { UsersRepository } from "../users/users.repository";
import { AccountClosureRepository } from "./account-closure.repository";
import { ClosurePreview, mapClosurePreview } from "./account-closure.mapper";
import { CloseAccountInput } from "./account.schemas";

/** Queue drained by the account-data worker; each job carries a bounded list of keys. */
export const ACCOUNT_MEDIA_ERASURE_QUEUE = "account.media-erasure";
const MEDIA_KEYS_PER_JOB = 100;
const MEDIA_ERASURE_MAX_ATTEMPTS = 10;

export const closedAccountEmail = (userId: string): string => `cerrada-${userId}@cuenta-cerrada.invalid`;

/**
 * Closes an account in ONE transaction: sessions, devices and every personal
 * row of the data map go, the gym's tax records stay de-identified and the
 * account row is anonymized. Files cannot join a database transaction, so
 * their erasure is enqueued in the outbox in that same transaction.
 */
@Injectable()
export class AccountClosureService {
  private readonly logger = new Logger(AccountClosureService.name);

  constructor(
    private readonly repository: AccountClosureRepository,
    private readonly users: UsersRepository,
    private readonly emailPins: EmailVerificationService,
    private readonly outbox: OutboxService,
    private readonly recommendations: SocialRecommendationOutboxService,
  ) {}

  async preview(userId: string): Promise<ClosurePreview> {
    const user = await this.activeUser(userId);
    const [counts, hasIdentity] = await Promise.all([
      this.repository.countSteps(userId),
      this.repository.hasLinkedIdentity(userId),
    ]);
    return mapClosurePreview(counts, {
      allowed: user.role === UserRole.CLIENT,
      pinAllowed: hasIdentity,
    });
  }

  /** Emails a CLOSE_ACCOUNT PIN; only for accounts created with a provider. */
  async requestPin(userId: string): Promise<void> {
    const user = await this.activeUser(userId);
    this.assertClosable(user);
    if (!(await this.repository.hasLinkedIdentity(userId))) throw passwordRequired();
    await this.repository.runInTransaction((transaction) =>
      this.emailPins.issuePurposePin(userId, "CLOSE_ACCOUNT", {
        subject: "Código para cerrar tu cuenta de GymSheet",
        lines: (pin) => [
          `Tu código para cerrar la cuenta es ${pin}`,
          "",
          `Caduca en ${EMAIL_PIN_POLICY.ttlMinutes} minutos. Cerrar la cuenta borra tus datos y no se puede deshacer.`,
          "",
          "Si no lo pediste, cambia tu contraseña: alguien entró a tu cuenta.",
        ],
      }, transaction),
    );
  }

  async close(userId: string, input: CloseAccountInput): Promise<{ closed: true; closedAt: Date }> {
    const user = await this.activeUser(userId);
    this.assertClosable(user);
    if (input.password !== undefined && !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw wrongPassword();
    }
    if (input.pin !== undefined && !(await this.repository.hasLinkedIdentity(userId))) throw passwordRequired();
    const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), env.BCRYPT_SALT_ROUNDS);

    // A wrong PIN must commit its attempt counter, so it is returned and thrown after commit.
    const result = await this.repository.runInTransaction(async (transaction): Promise<{ failed: EmailPinFailure } | { closedAt: Date }> => {
      await this.users.lockUserForUpdate(userId, transaction);
      if (!(await this.users.findActiveById(userId, transaction))) throw accountNotFound();
      if (input.pin !== undefined) {
        const outcome = await this.emailPins.verifyPurposePin(userId, "CLOSE_ACCOUNT", input.pin, transaction);
        if (outcome.kind !== "VERIFIED") return { failed: outcome };
      }
      return { closedAt: await this.eraseInTransaction(userId, unusablePasswordHash, transaction) };
    });
    if ("failed" in result) throw emailPinError(result.failed);
    this.logger.log({ event: "account.closed", userId });
    return { closed: true, closedAt: result.closedAt };
  }

  private async eraseInTransaction(userId: string, unusablePasswordHash: string, transaction: Transaction): Promise<Date> {
    const mediaKeys = await this.repository.collectMediaKeys(userId, transaction);
    await this.repository.eraseAll(userId, transaction);
    const closedAt = await this.repository.anonymizeAccount(
      userId,
      { tombstoneEmail: closedAccountEmail(userId), unusablePasswordHash },
      transaction,
    );
    // The account is inactive now, so the snapshot tells the recommender to drop the profile.
    await this.recommendations.enqueueProfileSnapshot(userId, transaction);
    const inUse = await this.repository.keysStillInUse(mediaKeys, transaction);
    await this.enqueueMediaErasure(userId, mediaKeys.filter((key) => !inUse.has(key)), closedAt, transaction);
    return closedAt;
  }

  private async enqueueMediaErasure(userId: string, keys: string[], closedAt: Date, transaction: Transaction) {
    for (let start = 0; start < keys.length; start += MEDIA_KEYS_PER_JOB) {
      await this.outbox.enqueue(
        {
          queueName: ACCOUNT_MEDIA_ERASURE_QUEUE,
          eventType: "account.media-erasure.v1",
          aggregateType: "account",
          aggregateId: userId,
          deduplicationKey: `account-media-erasure:${userId}:${closedAt.getTime()}:${start}`,
          payload: { storageKeys: keys.slice(start, start + MEDIA_KEYS_PER_JOB) },
          maxAttempts: MEDIA_ERASURE_MAX_ATTEMPTS,
        },
        transaction,
      );
    }
  }

  private async activeUser(userId: string): Promise<UserModel> {
    const user = await this.users.findActiveById(userId);
    if (!user) throw accountNotFound();
    return user;
  }

  /** Staff accounts carry the gym's operations; the gym closes them, not the app. */
  private assertClosable(user: UserModel): void {
    if (user.role !== UserRole.CLIENT) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        "ACCOUNT_CLOSURE_STAFF",
        "Las cuentas del personal las cierra el administrador del gimnasio.",
      );
    }
  }
}

function accountNotFound(): NotFoundException {
  return new NotFoundException("Usuario no encontrado o inactivo.");
}

export function wrongPassword(): DomainException {
  return new DomainException(HttpStatus.BAD_REQUEST, "CURRENT_PASSWORD_INVALID", "La contraseña no es correcta.");
}

function passwordRequired(): DomainException {
  return new DomainException(
    HttpStatus.BAD_REQUEST,
    "CLOSURE_PROOF_REQUIRED",
    "Confirma el cierre con tu contraseña.",
  );
}

import { HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Transaction } from "sequelize";
import { UserRole } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { effectiveTenantOf, isAccountInScope } from "../../common/tenancy/tenant-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { EMAIL_PIN_POLICY, EmailPinFailure, EmailVerificationService, emailPinError } from "../auth/email-verification.service";
import { ClosedAccountSanctionsService } from "../closed-account-sanctions/closed-account-sanctions.service";
import { MediaReleaseService } from "../media/media-release.service";
import { SocialRecommendationOutboxService } from "../social/social-recommendation-outbox.service";
import { UserModel } from "../users/user.model";
import { UsersRepository } from "../users/users.repository";
import { AccountClosureRepository } from "./account-closure.repository";
import { ClosurePreview, mapClosurePreview } from "./account-closure.mapper";
import { CloseAccountInput } from "./account.schemas";

export type ModerationClosureOutcome = "CLOSED" | "ALREADY_CLOSED" | "STAFF_SKIPPED";

export const closedAccountEmail = (userId: string): string => `cerrada-${userId}@cuenta-cerrada.invalid`;

/**
 * Closes an account in ONE transaction: sessions, devices and every personal
 * row of the data map go, the gym's tax records stay de-identified and the
 * account row is anonymized. Files cannot join a database transaction, so
 * their erasure is enqueued in that same transaction on the shared
 * `media.release` queue, one job per file. Strikes still counting are kept
 * under the hash of the email so closing does not wipe a sanction (ADR-0015).
 */
@Injectable()
export class AccountClosureService {
  private readonly logger = new Logger(AccountClosureService.name);

  constructor(
    private readonly repository: AccountClosureRepository,
    private readonly users: UsersRepository,
    private readonly emailPins: EmailVerificationService,
    private readonly mediaRelease: MediaReleaseService,
    private readonly recommendations: SocialRecommendationOutboxService,
    private readonly sanctions: ClosedAccountSanctionsService,
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
        subject: (brand) => `Código para cerrar tu cuenta de ${brand}`,
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
      const locked = await this.users.findActiveById(userId, transaction);
      if (!locked) throw accountNotFound();
      if (input.pin !== undefined) {
        const outcome = await this.emailPins.verifyPurposePin(userId, "CLOSE_ACCOUNT", input.pin, transaction);
        if (outcome.kind !== "VERIFIED") return { failed: outcome };
      }
      await this.sanctions.recordAtClosure(locked, transaction);
      return { closedAt: await this.eraseInTransaction(userId, unusablePasswordHash, transaction) };
    });
    if ("failed" in result) throw emailPinError(result.failed);
    this.logger.log({ event: "account.closed", userId });
    return { closed: true, closedAt: result.closedAt };
  }

  /**
   * Closure decided by moderation (a confirmed minor): no password or PIN, the
   * same erasure transaction. Members only; an account already closed, gone
   * or belonging to staff is left as is, so a retried job is a no-op.
   *
   * No closed-account sanction record is written: the closure IS the outcome
   * of the review, and its open-ended "pending review" suspension carried
   * under the email hash would lock the person out for good once they are an
   * adult. Strikes of other reasons go with the account for the same reason.
   */
  async closeByModeration(userId: string): Promise<ModerationClosureOutcome> {
    const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), env.BCRYPT_SALT_ROUNDS);
    const outcome = await this.repository.runInTransaction(async (transaction): Promise<ModerationClosureOutcome> => {
      await this.users.lockUserForUpdate(userId, transaction);
      const user = await this.users.findById(userId, transaction);
      if (!user || user.closedAt) return "ALREADY_CLOSED";
      if (user.role !== UserRole.CLIENT) return "STAFF_SKIPPED";
      await this.eraseInTransaction(userId, unusablePasswordHash, transaction);
      return "CLOSED";
    });
    this.logger.log({ event: "account.closed_by_moderation", userId, outcome });
    return outcome;
  }

  /**
   * A gym admin closes a staff account of their own gym (the staff cannot:
   * `ACCOUNT_CLOSURE_STAFF`). No password or PIN: the authority is the admin
   * role, and the audit log records who did it. Same erasure transaction as
   * any closure, with the strikes still counting carried as at a self-service
   * closure. Another gym's account, a member, a platform admin or an account
   * already closed reads as not found; the admin's own account and the gym's
   * last active admin are refused, so a gym never ends up without one.
   */
  async closeStaffByAdmin(actor: AuthenticatedUser, userId: string): Promise<{ closed: true; closedAt: Date }> {
    if (actor.id === userId) throw staffClosureError("STAFF_CLOSURE_SELF", "No puedes cerrar tu propia cuenta desde aquí.");
    const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), env.BCRYPT_SALT_ROUNDS);
    const closedAt = await this.repository.runInTransaction(async (transaction) => {
      const candidate = await this.users.findActiveById(userId, transaction);
      this.assertStaffInScope(candidate, actor);
      if (candidate.role === UserRole.ADMIN) {
        const admins = await this.repository.lockActiveAdmins(effectiveTenantOf(candidate), env.DEFAULT_TENANT_ID, transaction);
        if (admins.length <= 1) {
          throw staffClosureError("STAFF_CLOSURE_LAST_ADMIN", "Es el único administrador del gimnasio: nombra otro antes de cerrar esta cuenta.");
        }
      }
      await this.users.lockUserForUpdate(userId, transaction);
      const locked = await this.users.findActiveById(userId, transaction);
      this.assertStaffInScope(locked, actor);
      await this.sanctions.recordAtClosure(locked, transaction);
      return this.eraseInTransaction(userId, unusablePasswordHash, transaction);
    });
    this.logger.log({ event: "account.closed_by_admin", userId, actorUserId: actor.id });
    return { closed: true, closedAt };
  }

  private assertStaffInScope(user: UserModel | null, actor: AuthenticatedUser): asserts user is UserModel {
    // Platform accounts are not gym staff: a gym cannot close them (ADR-0018).
    const platformAccount = user?.role === UserRole.SYSTEM_ADMIN || user?.role === UserRole.MODERATOR;
    if (!user || platformAccount || !isAccountInScope(user, actor.tenantScope)) throw accountNotFound();
    if (user.role === UserRole.CLIENT) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        "STAFF_CLOSURE_NOT_STAFF",
        "Las cuentas de socios las cierra cada socio desde su app.",
      );
    }
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
    for (const storageKey of mediaKeys.filter((key) => !inUse.has(key))) {
      await this.mediaRelease.requestRelease({ aggregateType: "account", aggregateId: userId, storageKey }, transaction);
    }
    return closedAt;
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

/** 403: the request is understood, the gym's rules forbid it. */
function staffClosureError(code: "STAFF_CLOSURE_SELF" | "STAFF_CLOSURE_LAST_ADMIN", message: string): DomainException {
  return new DomainException(HttpStatus.FORBIDDEN, code, message);
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

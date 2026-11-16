import { ConflictException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { ClosedAccountSanctionsService } from "../closed-account-sanctions/closed-account-sanctions.service";
import { EMAIL_PIN_POLICY, EmailPinFailure, EmailVerificationService, emailPinError } from "../auth/email-verification.service";
import { NotificationService } from "../notifications/notification.service";
import { UsersRepository } from "../users/users.repository";
import { wrongPassword } from "./account-closure.service";
import { EmailChangeRequestInput } from "./account.schemas";

const EMAIL_TAKEN = "Ese correo ya está registrado en otra cuenta.";

/**
 * Changes the login address in two steps: the password authorizes the request
 * and a PIN sent to the NEW mailbox proves it. The address is only swapped on
 * confirmation; the old mailbox is told through the outbox.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly emailPins: EmailVerificationService,
    private readonly notifications: NotificationService,
    private readonly sequelize: Sequelize,
    private readonly sanctions: ClosedAccountSanctionsService,
  ) {}

  /**
   * An address already taken still gets its PIN: answering 409 here would let
   * any account probe which emails are registered. The 409 comes at confirm,
   * once the caller has proven the mailbox is theirs.
   */
  async request(userId: string, input: EmailChangeRequestInput): Promise<void> {
    const user = await this.users.findActiveById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado o inactivo.");
    if (!(await bcrypt.compare(input.password, user.passwordHash))) throw wrongPassword();
    if (input.newEmail === user.email) {
      throw new DomainException(HttpStatus.BAD_REQUEST, "EMAIL_UNCHANGED", "Ese ya es tu correo.");
    }
    if (await this.sanctions.hasActiveSanction(userId)) throw blockedBySanction();
    await this.sequelize.transaction((transaction) =>
      this.emailPins.issuePurposePin(userId, "CHANGE_EMAIL", {
        subject: "Confirma tu nuevo correo en GymSheet",
        lines: (pin) => [
          `Tu código para usar este correo en GymSheet es ${pin}`,
          "",
          `Caduca en ${EMAIL_PIN_POLICY.ttlMinutes} minutos y sólo sirve una vez.`,
          "",
          "Si no lo pediste, ignora este mensaje: el correo de la cuenta no cambia.",
        ],
        recipientEmail: input.newEmail,
        targetEmail: input.newEmail,
      }, transaction),
    );
  }

  async confirm(userId: string, pin: string): Promise<{ email: string; emailVerified: true }> {
    try {
      // A wrong PIN must commit its attempt counter: returned, then thrown after commit.
      const result = await this.sequelize.transaction(async (transaction): Promise<{ failed: EmailPinFailure } | { email: string }> => {
        await this.users.lockUserForUpdate(userId, transaction);
        const user = await this.users.findActiveById(userId, transaction);
        if (!user) throw new NotFoundException("Usuario no encontrado o inactivo.");
        // A strike can land between the request and the PIN: checked again under the account lock.
        if (await this.sanctions.hasActiveSanction(userId, transaction)) throw blockedBySanction();
        const outcome = await this.emailPins.verifyPurposePin(userId, "CHANGE_EMAIL", pin, transaction);
        if (outcome.kind !== "VERIFIED") return { failed: outcome };
        const newEmail = outcome.targetEmail;
        if (!newEmail) throw new Error("CHANGE_EMAIL PIN without a target address.");
        const holder = await this.users.findByEmail(newEmail, transaction);
        if (holder && holder.id !== userId) throw new ConflictException(EMAIL_TAKEN);
        const oldEmail = user.email;
        await this.users.changeEmail(userId, newEmail, transaction);
        await this.notifications.enqueueDirectMessage({
          recipientUserId: userId,
          channel: NotificationChannel.EMAIL,
          subject: "El correo de tu cuenta de GymSheet cambió",
          body: [
            "El correo para entrar a tu cuenta de GymSheet se cambió por otro.",
            "",
            "Si no fuiste tú, recupera tu contraseña desde la app y escríbenos.",
          ].join("\n"),
          deduplicationKey: `email-changed-${userId}-${Date.now()}`,
          metadata: { kind: "EMAIL_CHANGED", recipientEmail: oldEmail },
        }, transaction);
        return { email: newEmail };
      });
      if ("failed" in result) throw emailPinError(result.failed);
      return { email: result.email, emailVerified: true };
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new ConflictException(EMAIL_TAKEN);
      throw error;
    }
  }
}

/** Ban evasion through an email change followed by a closure (ADR-0015). */
function blockedBySanction(): DomainException {
  return new DomainException(
    HttpStatus.CONFLICT,
    "EMAIL_CHANGE_BLOCKED_BY_SANCTION",
    "No puedes cambiar el correo mientras tengas sanciones de moderación vigentes.",
  );
}

import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/** What a PIN proves; each purpose has its own cooldown, daily cap and live code. */
export type EmailPinPurpose = "VERIFY_EMAIL" | "CHANGE_EMAIL" | "CLOSE_ACCOUNT";

export type EmailPinRow = {
  id: string;
  /** New address of a `CHANGE_EMAIL` PIN; null for the other purposes. */
  targetEmail: string | null;
  pinHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
};

export type EmailPinSendWindow = {
  /** PINs issued inside the window. */
  sent: number;
  latest: Date | null;
  oldest: Date | null;
};

/** Data access for `auth.email_verification_pins`. */
@Injectable()
export class EmailVerificationPinRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async sendWindow(
    userId: string,
    since: Date,
    transaction: Transaction,
    purpose: EmailPinPurpose,
  ): Promise<EmailPinSendWindow> {
    const [row] = await this.sequelize.query<{ sent: number; latest: Date | null; oldest: Date | null }>(
      `SELECT count(*)::int AS sent, max(created_at) AS latest, min(created_at) AS oldest
         FROM auth.email_verification_pins
        WHERE user_id = :userId AND purpose = :purpose AND created_at > :since`,
      { type: QueryTypes.SELECT, replacements: { userId, since, purpose }, transaction },
    );
    return { sent: row?.sent ?? 0, latest: row?.latest ?? null, oldest: row?.oldest ?? null };
  }

  /** A new PIN retires the previous one: never two live codes per account. */
  async supersedePending(userId: string, transaction: Transaction, purpose: EmailPinPurpose): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.email_verification_pins SET consumed_at = now()
        WHERE user_id = :userId AND purpose = :purpose AND consumed_at IS NULL`,
      { type: QueryTypes.UPDATE, replacements: { userId, purpose }, transaction },
    );
  }

  async insert(
    userId: string,
    pinHash: string,
    expiresAt: Date,
    transaction: Transaction,
    scope: { purpose: EmailPinPurpose; targetEmail: string | null },
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO auth.email_verification_pins (user_id, pin_hash, expires_at, purpose, target_email)
       VALUES (:userId, :pinHash, :expiresAt, :purpose, :targetEmail)`,
      {
        type: QueryTypes.INSERT,
        replacements: { userId, pinHash, expiresAt, purpose: scope.purpose, targetEmail: scope.targetEmail },
        transaction,
      },
    );
  }

  /** Latest PIN of the account, row-locked so concurrent guesses are serialized. */
  async findLatestForUpdate(
    userId: string,
    transaction: Transaction,
    purpose: EmailPinPurpose,
  ): Promise<EmailPinRow | null> {
    const [row] = await this.sequelize.query<EmailPinRow>(
      `SELECT id, pin_hash AS "pinHash", expires_at AS "expiresAt",
              consumed_at AS "consumedAt", attempts, target_email AS "targetEmail"
         FROM auth.email_verification_pins
        WHERE user_id = :userId AND purpose = :purpose
        ORDER BY created_at DESC
        LIMIT 1
          FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { userId, purpose }, transaction },
    );
    return row ?? null;
  }

  async recordFailedAttempt(id: string, burn: boolean, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.email_verification_pins
          SET attempts = attempts + 1,
              consumed_at = CASE WHEN :burn THEN now() ELSE consumed_at END
        WHERE id = :id`,
      { type: QueryTypes.UPDATE, replacements: { id, burn }, transaction },
    );
  }

  async consume(id: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.email_verification_pins SET consumed_at = now() WHERE id = :id`,
      { type: QueryTypes.UPDATE, replacements: { id }, transaction },
    );
  }
}

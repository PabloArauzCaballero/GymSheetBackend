import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

export type EmailPinRow = {
  id: string;
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

  async sendWindow(userId: string, since: Date, transaction: Transaction): Promise<EmailPinSendWindow> {
    const [row] = await this.sequelize.query<{ sent: number; latest: Date | null; oldest: Date | null }>(
      `SELECT count(*)::int AS sent, max(created_at) AS latest, min(created_at) AS oldest
         FROM auth.email_verification_pins
        WHERE user_id = :userId AND created_at > :since`,
      { type: QueryTypes.SELECT, replacements: { userId, since }, transaction },
    );
    return { sent: row?.sent ?? 0, latest: row?.latest ?? null, oldest: row?.oldest ?? null };
  }

  /** A new PIN retires the previous one: never two live codes per account. */
  async supersedePending(userId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.email_verification_pins SET consumed_at = now()
        WHERE user_id = :userId AND consumed_at IS NULL`,
      { type: QueryTypes.UPDATE, replacements: { userId }, transaction },
    );
  }

  async insert(userId: string, pinHash: string, expiresAt: Date, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO auth.email_verification_pins (user_id, pin_hash, expires_at)
       VALUES (:userId, :pinHash, :expiresAt)`,
      { type: QueryTypes.INSERT, replacements: { userId, pinHash, expiresAt }, transaction },
    );
  }

  /** Latest PIN of the account, row-locked so concurrent guesses are serialized. */
  async findLatestForUpdate(userId: string, transaction: Transaction): Promise<EmailPinRow | null> {
    const [row] = await this.sequelize.query<EmailPinRow>(
      `SELECT id, pin_hash AS "pinHash", expires_at AS "expiresAt",
              consumed_at AS "consumedAt", attempts
         FROM auth.email_verification_pins
        WHERE user_id = :userId
        ORDER BY created_at DESC
        LIMIT 1
          FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
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

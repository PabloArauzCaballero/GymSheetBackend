import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { StrikeKind } from "../moderation/moderation.policy";

/** A strike still counting, as copied from `moderation.user_strikes`. No note, target or moderator. */
export const carriedStrikeSchema = z
  .object({
    kind: z.enum([StrikeKind.ADVERTENCIA, StrikeKind.SUSPENSION, StrikeKind.EXPULSION]),
    reason: z.string().min(1).max(30),
    tenantId: z.string().min(1).max(60),
    suspendedUntil: z.string().datetime({ offset: true }).nullable(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type CarriedStrike = z.infer<typeof carriedStrikeSchema>;

export type SanctionSnapshot = { suspendedUntil: Date | null; strikes: CarriedStrike[] };

const storedSchema = z.object({ suspendedUntil: z.date().nullable(), strikes: z.array(carriedStrikeSchema) });

/** Note on an inherited strike row: says where it came from, carries nothing personal. */
const CARRIED_NOTE = "Heredada de una cuenta cerrada con el mismo correo.";

/** Data access of the ban-evasion guard (ADR-0015). Reads moderation tables, never writes them except strikes. */
@Injectable()
export class ClosedAccountSanctionsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /** Running suspension and strikes still inside the counting window, read before the closure wipes them. */
  async activeSanction(userId: string, now: Date, transaction: Transaction): Promise<SanctionSnapshot> {
    const [account] = await this.sequelize.query<{ suspendedUntil: Date | null }>(
      `SELECT CASE WHEN suspended_until > :now THEN suspended_until END AS "suspendedUntil"
         FROM public.usuarios WHERE id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId, now }, transaction },
    );
    const strikes = await this.sequelize.query<CarriedStrike>(
      `SELECT kind, reason, tenant_id AS "tenantId",
              to_char(suspended_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "suspendedUntil",
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"
         FROM moderation.user_strikes WHERE user_id = :userId AND expires_at > :now ORDER BY created_at`,
      { type: QueryTypes.SELECT, replacements: { userId, now }, transaction },
    );
    return { suspendedUntil: account?.suspendedUntil ?? null, strikes: z.array(carriedStrikeSchema).parse(strikes) };
  }

  async insert(emailHmac: string, snapshot: SanctionSnapshot, expiresAt: Date, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO moderation.closed_account_sanctions (email_hmac, suspended_until, strike_count, strikes, expires_at)
       VALUES (:emailHmac, :suspendedUntil, :strikeCount, CAST(:strikes AS jsonb), :expiresAt)`,
      {
        replacements: {
          emailHmac,
          suspendedUntil: snapshot.suspendedUntil,
          strikeCount: snapshot.strikes.length,
          strikes: JSON.stringify(snapshot.strikes),
          expiresAt,
        },
        transaction,
      },
    );
  }

  /** Deletes and returns every unexpired record of this email: a record is used once. */
  async consume(emailHmac: string, now: Date, transaction: Transaction): Promise<SanctionSnapshot[]> {
    const rows = await this.sequelize.query<{ suspendedUntil: Date | null; strikes: unknown }>(
      `WITH consumed AS (
         DELETE FROM moderation.closed_account_sanctions
          WHERE email_hmac = :emailHmac AND expires_at > :now
         RETURNING suspended_until, strikes)
       SELECT suspended_until AS "suspendedUntil", strikes FROM consumed`,
      { type: QueryTypes.SELECT, replacements: { emailHmac, now }, transaction },
    );
    return rows.map((row) => storedSchema.parse({ ...row, suspendedUntil: row.suspendedUntil && new Date(row.suspendedUntil) }));
  }

  /** Re-creates the strikes on the new account so the ladder (`countActiveStrikes`) keeps counting them. */
  async insertStrikes(userId: string, tenantId: string | null, strikes: CarriedStrike[], transaction: Transaction): Promise<void> {
    if (strikes.length === 0) return;
    await this.sequelize.query(
      `INSERT INTO moderation.user_strikes (id, user_id, tenant_id, kind, reason, note, suspended_until, expires_at)
       SELECT uuid_generate_v4(), :userId, COALESCE(:tenantId, s."tenantId"), s.kind, s.reason, :note,
              s."suspendedUntil", s."expiresAt"
         FROM jsonb_to_recordset(CAST(:strikes AS jsonb))
           AS s(kind varchar, reason varchar, "tenantId" varchar, "suspendedUntil" timestamptz, "expiresAt" timestamptz)`,
      { replacements: { userId, tenantId, note: CARRIED_NOTE, strikes: JSON.stringify(strikes) }, transaction },
    );
  }

  async setSuspension(userId: string, suspendedUntil: Date, transaction: Transaction): Promise<void> {
    await this.sequelize.query(`UPDATE public.usuarios SET suspended_until = :suspendedUntil WHERE id = :userId`, {
      replacements: { userId, suspendedUntil },
      transaction,
    });
  }
}

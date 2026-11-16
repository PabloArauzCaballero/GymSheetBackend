import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/** Reads, from `moderation.user_strikes`, which sanction an account is under right now. */
@Injectable()
export class SanctionStatusRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /** Reason of the running suspension that ends last (the one `usuarios.suspended_until` mirrors). */
  async runningSuspensionReason(userId: string, now: Date): Promise<string | null> {
    const [row] = await this.sequelize.query<{ reason: string }>(
      `SELECT reason FROM moderation.user_strikes
        WHERE user_id = :userId AND kind = 'SUSPENSION' AND suspended_until > :now
        ORDER BY suspended_until DESC, created_at DESC LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { userId, now } },
    );
    return row?.reason ?? null;
  }

  /**
   * Reason of the latest expulsion of an account that is still banned. The
   * marker is the EXPULSION strike itself on an inactive, not closed account:
   * `estado = 'INACTIVO'` alone also covers closed accounts and accounts the
   * seed created inactive, and a strike is only revoked by deleting it.
   */
  async banReason(userId: string): Promise<string | null> {
    const [row] = await this.sequelize.query<{ reason: string }>(
      `SELECT s.reason FROM moderation.user_strikes s JOIN public.usuarios u ON u.id = s.user_id
        WHERE s.user_id = :userId AND s.kind = 'EXPULSION' AND u.estado = 'INACTIVO' AND u.closed_at IS NULL
        ORDER BY s.created_at DESC LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row?.reason ?? null;
  }
}

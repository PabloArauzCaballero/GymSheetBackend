import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { ConsentKind } from "../legal/consent-versions";
import type { LegalChannel } from "../legal/legal-client-context";

export type ConsentRow = {
  kind: ConsentKind;
  version: string;
  grantedAt: Date;
  revokedAt: Date | null;
};

/**
 * What revoking a consent erases, in the same transaction that closes it. The
 * statements reach into the tables that hold the datum (onboarding, social
 * profile, map) on purpose: the revocation and the erasure must commit or
 * fail together, and the owning modules depend on this one, not the reverse.
 */
const ERASURE: Record<ConsentKind, readonly string[]> = {
  HEALTH: [
    `UPDATE profile.onboarding
        SET physical_considerations = NULL, consent_health = FALSE, updated_at = NOW()
      WHERE user_id = :userId AND (physical_considerations IS NOT NULL OR consent_health)`,
  ],
  ORIENTATION: [
    `UPDATE social.profile_details
        SET orientation = NULL, orientation_visible = FALSE, version = version + 1, updated_at = NOW()
      WHERE user_id = :userId AND (orientation IS NOT NULL OR orientation_visible)`,
  ],
  PRECISE_LOCATION: [
    `DELETE FROM social.map_locations WHERE user_id = :userId`,
    `UPDATE social.profile_settings
        SET map_enabled = FALSE, map_enabled_since = NULL, version = version + 1, updated_at = NOW()
      WHERE user_id = :userId AND map_enabled`,
  ],
  // The selfie check arrives in franja 6; until then there is nothing stored to erase.
  VERIFICATION_SELFIE: [],
};

const ROW_COLUMNS = `kind, version, granted_at AS "grantedAt", revoked_at AS "revokedAt"`;

@Injectable()
export class ConsentsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  /** The most recent grant of each kind (open or revoked). */
  latestPerKind(userId: string): Promise<ConsentRow[]> {
    return this.sequelize.query<ConsentRow>(
      `SELECT DISTINCT ON (kind) ${ROW_COLUMNS}
         FROM auth.consents WHERE user_id = :userId
        ORDER BY kind, granted_at DESC, id DESC`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
  }

  /**
   * The open consent, locked: `FOR SHARE` from a write that depends on it, so
   * a concurrent revocation waits for that write and then erases it;
   * `FOR UPDATE` from grant and revoke, which change the row.
   */
  async findOpen(
    userId: string,
    kind: ConsentKind,
    transaction: Transaction,
    lock: "SHARE" | "UPDATE",
  ): Promise<ConsentRow | null> {
    const rows = await this.sequelize.query<ConsentRow>(
      `SELECT ${ROW_COLUMNS} FROM auth.consents
        WHERE user_id = :userId AND kind = :kind AND revoked_at IS NULL
        FOR ${lock === "SHARE" ? "SHARE" : "UPDATE"}`,
      { type: QueryTypes.SELECT, replacements: { userId, kind }, transaction },
    );
    return rows[0] ?? null;
  }

  async close(userId: string, kind: ConsentKind, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.consents SET revoked_at = GREATEST(NOW(), granted_at)
        WHERE user_id = :userId AND kind = :kind AND revoked_at IS NULL`,
      { type: QueryTypes.UPDATE, replacements: { userId, kind }, transaction },
    );
  }

  /** A concurrent identical grant wins the partial unique index; this one becomes a no-op. */
  async open(
    userId: string,
    kind: ConsentKind,
    version: string,
    channel: LegalChannel,
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO auth.consents (user_id, kind, version, channel)
       VALUES (:userId, :kind, :version, :channel)
       ON CONFLICT (user_id, kind) WHERE revoked_at IS NULL DO NOTHING`,
      { type: QueryTypes.INSERT, replacements: { userId, kind, version, channel }, transaction },
    );
  }

  async eraseData(userId: string, kind: ConsentKind, transaction: Transaction): Promise<void> {
    for (const statement of ERASURE[kind]) {
      await this.sequelize.query(statement, { replacements: { userId }, transaction });
    }
  }
}

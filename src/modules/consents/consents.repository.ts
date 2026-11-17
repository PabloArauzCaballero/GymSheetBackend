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

/** A stored file whose last reference an erasure statement just cleared. */
export type ErasedMedia = { aggregateType: string; aggregateId: string; storageKey: string };

/**
 * What revoking a consent erases, in the same transaction that closes it. The
 * statements reach into the tables that hold the datum (onboarding, social
 * profile, map, selfies) on purpose: the revocation and the erasure must
 * commit or fail together, and the owning modules depend on this one, not the
 * reverse. A statement that clears a storage key RETURNS it as `ErasedMedia`
 * so the service queues the file on `media.release` in the same transaction.
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
  // Every stored selfie goes now, whatever its retention date; open attempts are cancelled
  // (EXPIRED). The decision record and `verified_at` stay: the consent covers processing the
  // image, and the moderator's decision is a fact already taken (ADR-0014, franja 6).
  VERIFICATION_SELFIE: [
    `WITH target AS (
       SELECT id, selfie_storage_key FROM social.photo_verifications
        WHERE user_id = :userId
          AND (selfie_storage_key IS NOT NULL OR status IN ('PENDING_UPLOAD', 'PENDING_REVIEW'))
        FOR UPDATE)
     UPDATE social.photo_verifications v
        SET status = CASE WHEN v.status IN ('PENDING_UPLOAD', 'PENDING_REVIEW') THEN 'EXPIRED' ELSE v.status END,
            selfie_storage_key = NULL, selfie_mime_type = NULL,
            selfie_deleted_at = CASE WHEN target.selfie_storage_key IS NULL THEN v.selfie_deleted_at ELSE NOW() END
       FROM target WHERE v.id = target.id
     RETURNING 'social.photo_verifications' AS "aggregateType", v.id::text AS "aggregateId",
               target.selfie_storage_key AS "storageKey"`,
  ],
  // Business KYC (ADR-0021): every stored representative selfie goes now and the pending gesture
  // is cancelled. Decisions already taken stay; a submission waiting for REPP is reviewed without it.
  KYC_SELFIE: [
    `UPDATE business.kyc_submissions SET selfie_challenge_code = NULL, selfie_challenge_expires_at = NULL, updated_at = NOW()
      WHERE account_id = :userId AND selfie_challenge_code IS NOT NULL`,
    `WITH target AS (
       SELECT d.id, d.storage_key FROM business.kyc_documents d
         JOIN business.kyc_submissions s ON s.id = d.submission_id
        WHERE s.account_id = :userId AND d.kind = 'SELFIE' AND d.deleted_at IS NULL
        FOR UPDATE OF d)
     UPDATE business.kyc_documents d SET storage_key = NULL, deleted_at = NOW(), delete_reason = 'USER_REQUEST'
       FROM target WHERE d.id = target.id
     RETURNING 'business.kyc_documents' AS "aggregateType", d.id::text AS "aggregateId", target.storage_key AS "storageKey"`,
  ],
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

  /** Runs the erasure of `kind`; returns the stored files it unreferenced. */
  async eraseData(userId: string, kind: ConsentKind, transaction: Transaction): Promise<ErasedMedia[]> {
    const erased: ErasedMedia[] = [];
    for (const statement of ERASURE[kind]) {
      const rows = await this.sequelize.query<Partial<ErasedMedia>>(statement, {
        type: QueryTypes.SELECT,
        replacements: { userId },
        transaction,
      });
      for (const { aggregateType, aggregateId, storageKey } of rows) {
        if (aggregateType && aggregateId && storageKey) erased.push({ aggregateType, aggregateId, storageKey });
      }
    }
    return erased;
  }
}

import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReleaseService } from "../media/media-release.service";
import { kycRetention } from "./kyc.catalog";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const KYC_DOCUMENT_AGGREGATE = "business.kyc_documents";

export interface KycRetentionResult {
  /** Document files cleared per rule; each one queued on `media.release` in the same transaction. */
  readonly documentsErased: Record<KycDocumentRule, number>;
  /** Encrypted NIT/CI/phone nulled on rejected attempts and closed accounts (masks and HMACs stay). */
  readonly identitiesErased: number;
  readonly phoneCodesDeleted: number;
  /** Closed businesses whose KYC records (decisions, checks, history, fingerprints) reached their 5 years. */
  readonly recordsPurgedAccounts: number;
  /** Revoked fingerprints past the records period. */
  readonly revokedFingerprintsDeleted: number;
}

type KycDocumentRule = "ABANDONED_DRAFT" | "REJECTED" | "SELFIE_DECIDED" | "SUPERSEDED" | "CLOSED_ACCOUNT";

type RetentionDays = ReturnType<typeof kycRetention>;

/** Which live documents each rule erases (alias `d` = document, `s` = its submission, `a` = the account). */
const DOCUMENT_RULES: Record<KycDocumentRule, { where: string; days: keyof RetentionDays; reason: "RETENTION" | "CLOSURE" }> = {
  ABANDONED_DRAFT: { where: "s.status = 'DRAFT' AND s.updated_at < :cutoff", days: "ABANDONED_DRAFT_DAYS", reason: "RETENTION" },
  REJECTED: { where: "s.status = 'REJECTED' AND s.decided_at < :cutoff", days: "REJECTED_DAYS", reason: "RETENTION" },
  SELFIE_DECIDED: {
    where: "d.kind = 'SELFIE' AND s.status IN ('AUTO_APPROVED', 'APPROVED', 'SUSPENDED', 'REJECTED', 'SUPERSEDED') AND s.decided_at < :cutoff",
    days: "SELFIE_AFTER_DECISION_DAYS",
    reason: "RETENTION",
  },
  SUPERSEDED: {
    where: `s.status IN ('AUTO_APPROVED', 'APPROVED', 'SUSPENDED', 'SUPERSEDED') AND s.decided_at < :cutoff
            AND a.current_submission_id IS DISTINCT FROM s.id`,
    days: "SUPERSEDED_DAYS",
    reason: "RETENTION",
  },
  // The CI of an approved business is kept while it is active and this long after it closed (fraud investigation).
  CLOSED_ACCOUNT: { where: "a.status = 'CLOSED' AND a.closed_at < :cutoff", days: "CLOSED_ACCOUNT_DAYS", reason: "CLOSURE" },
};

/** Closed accounts whose records go, a batch at a time; their documents must already be gone. */
const RECORDS_DUE = `SELECT a.user_id FROM business.accounts a
  WHERE a.status = 'CLOSED' AND a.closed_at < :cutoff
    AND EXISTS (SELECT 1 FROM business.kyc_submissions s WHERE s.account_id = a.user_id)
    AND NOT EXISTS (SELECT 1 FROM business.kyc_documents d JOIN business.kyc_submissions s ON s.id = d.submission_id
                     WHERE s.account_id = a.user_id AND d.deleted_at IS NULL)
  ORDER BY a.closed_at LIMIT :limit FOR UPDATE OF a SKIP LOCKED`;
const OF_ACCOUNTS = "SELECT s.id FROM business.kyc_submissions s WHERE s.account_id IN (:accountIds)";

/**
 * KYC step of the daily privacy retention (plan §2.14, ADR-0021, ADR-0028).
 * The periods are `kycRetention()` (env `KYC_RETENTION_*_DAYS`), proposed and
 * pending the lawyer. Decisions, checks, history and fingerprints (codes and
 * HMACs, no image or datum in clear) stay while the business exists and 5
 * years after it closed. Each batch clears the keys and queues the
 * files on `media.release` in one transaction; a file still referenced by a
 * newer version of the same business (copied documents) is kept by the
 * release itself.
 */
@Injectable()
export class KycRetentionService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  async purge(now: Date): Promise<KycRetentionResult> {
    const days = kycRetention();
    const documentsErased = {} as Record<KycDocumentRule, number>;
    for (const rule of Object.keys(DOCUMENT_RULES) as KycDocumentRule[]) documentsErased[rule] = await this.purgeRule(rule, now, days);
    const identitiesErased = await this.eraseIdentities(now, days);
    const phoneCodesDeleted = await this.count(
      `DELETE FROM business.phone_verifications WHERE verified_at IS NULL AND created_at < :cutoff RETURNING 1`,
      { cutoff: before(now, days.PHONE_CODE_DAYS) },
    );
    const recordsPurgedAccounts = await this.purgeRecords(before(now, days.RECORDS_DAYS));
    const revokedFingerprintsDeleted = await this.count(
      `DELETE FROM business.identity_fingerprints WHERE revoked_at IS NOT NULL AND revoked_at < :cutoff RETURNING 1`,
      { cutoff: before(now, days.RECORDS_DAYS) },
    );
    return { documentsErased, identitiesErased, phoneCodesDeleted, recordsPurgedAccounts, revokedFingerprintsDeleted };
  }

  /**
   * Five years after a business closed, its KYC trail goes: status history,
   * decisions, checks, document rows (their files went at 180 days),
   * fingerprints and the attempts themselves. The account row stays (the
   * listing and the buyers' orders hang from it), without a current attempt.
   */
  private async purgeRecords(cutoff: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const purged = await this.sequelize.transaction(async (transaction) => {
        const due = await this.sequelize.query<{ user_id: string }>(RECORDS_DUE, { type: QueryTypes.SELECT, replacements: { cutoff, limit: BATCH_SIZE }, transaction });
        const accountIds = due.map((row) => row.user_id);
        if (accountIds.length === 0) return 0;
        for (const statement of [
          `DELETE FROM business.kyc_status_history WHERE account_id IN (:accountIds)`,
          `DELETE FROM business.kyc_decisions WHERE submission_id IN (${OF_ACCOUNTS})`,
          `DELETE FROM business.kyc_checks WHERE submission_id IN (${OF_ACCOUNTS})`,
          `DELETE FROM business.kyc_documents WHERE submission_id IN (${OF_ACCOUNTS})`,
          `DELETE FROM business.identity_fingerprints WHERE account_id IN (:accountIds)`,
          `UPDATE business.accounts SET current_submission_id = NULL, updated_at = now() WHERE user_id IN (:accountIds)`,
          `DELETE FROM business.kyc_submissions WHERE account_id IN (:accountIds)`,
        ]) {
          await this.sequelize.query(statement, { replacements: { accountIds }, transaction });
        }
        return accountIds.length;
      });
      total += purged;
      if (purged < BATCH_SIZE) return total;
    }
  }

  private async purgeRule(rule: KycDocumentRule, now: Date, retention: RetentionDays): Promise<number> {
    const { where, days, reason } = DOCUMENT_RULES[rule];
    const cutoff = before(now, retention[days]);
    let total = 0;
    for (;;) {
      const erased = await this.sequelize.transaction(async (transaction) => {
        const rows = await this.sequelize.query<{ id: string; storageKey: string; provider: string }>(
          `WITH target AS (
             SELECT d.id, d.storage_key FROM business.kyc_documents d
               JOIN business.kyc_submissions s ON s.id = d.submission_id
               JOIN business.accounts a ON a.user_id = s.account_id
              WHERE d.deleted_at IS NULL AND ${where}
              ORDER BY d.uploaded_at LIMIT :limit
              FOR UPDATE OF d SKIP LOCKED)
           UPDATE business.kyc_documents d SET storage_key = NULL, deleted_at = :now, delete_reason = :reason
             FROM target WHERE d.id = target.id
           RETURNING d.id, target.storage_key AS "storageKey", d.storage_provider AS provider`,
          { type: QueryTypes.SELECT, replacements: { cutoff, now, reason, limit: BATCH_SIZE }, transaction },
        );
        await this.release(rows, transaction);
        return rows.length;
      });
      total += erased;
      if (erased < BATCH_SIZE) return total;
    }
  }

  private async release(rows: readonly { id: string; storageKey: string; provider: string }[], transaction: Transaction): Promise<void> {
    for (const row of rows) {
      await this.mediaRelease.requestRelease(
        { aggregateType: KYC_DOCUMENT_AGGREGATE, aggregateId: row.id, provider: row.provider, storageKey: row.storageKey },
        transaction,
      );
    }
  }

  /**
   * The encrypted NIT, CI and phone of rejected attempts and closed accounts
   * past their period; a closed account also loses the representative's
   * name, address and CI complement (no datum in clear is kept for 5 years).
   * Masks and HMACs stay.
   */
  private eraseIdentities(now: Date, retention: RetentionDays): Promise<number> {
    const closed = "a.status = 'CLOSED' AND a.closed_at < :closedCutoff";
    return this.count(
      `UPDATE business.kyc_submissions s SET nit_enc = NULL, rep_ci_enc = NULL, phone_enc = NULL,
              rep_full_name = CASE WHEN ${closed} THEN NULL ELSE s.rep_full_name END,
              address = CASE WHEN ${closed} THEN NULL ELSE s.address END,
              rep_ci_complement = CASE WHEN ${closed} THEN NULL ELSE s.rep_ci_complement END,
              updated_at = :now
         FROM business.accounts a
        WHERE a.user_id = s.account_id
          AND ((s.status = 'REJECTED' AND s.decided_at < :rejectedCutoff
                AND (s.nit_enc IS NOT NULL OR s.rep_ci_enc IS NOT NULL OR s.phone_enc IS NOT NULL))
            OR (${closed} AND (s.nit_enc IS NOT NULL OR s.rep_ci_enc IS NOT NULL OR s.phone_enc IS NOT NULL
                OR s.rep_full_name IS NOT NULL OR s.address IS NOT NULL OR s.rep_ci_complement IS NOT NULL)))
       RETURNING 1`,
      { now, rejectedCutoff: before(now, retention.REJECTED_DAYS), closedCutoff: before(now, retention.CLOSED_ACCOUNT_DAYS) },
    );
  }

  private async count(statement: string, replacements: Record<string, unknown>): Promise<number> {
    const rows = await this.sequelize.query(`WITH changed AS (${statement}) SELECT count(*)::int AS count FROM changed`, {
      type: QueryTypes.SELECT,
      replacements,
    });
    return (rows[0] as { count?: number } | undefined)?.count ?? 0;
  }
}

function before(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

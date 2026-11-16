import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReleaseService } from "../media/media-release.service";
import { KYC_RETENTION } from "./kyc.catalog";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const KYC_DOCUMENT_AGGREGATE = "business.kyc_documents";

export interface KycRetentionResult {
  /** Document files cleared per rule; each one queued on `media.release` in the same transaction. */
  readonly documentsErased: Record<KycDocumentRule, number>;
  /** Encrypted NIT/CI/phone nulled on rejected attempts and closed accounts (masks and HMACs stay). */
  readonly identitiesErased: number;
  readonly phoneCodesDeleted: number;
}

type KycDocumentRule = "ABANDONED_DRAFT" | "REJECTED" | "SELFIE_DECIDED" | "SUPERSEDED" | "CLOSED_ACCOUNT";

/** Which live documents each rule erases (alias `d` = document, `s` = its submission, `a` = the account). */
const DOCUMENT_RULES: Record<KycDocumentRule, { where: string; days: number; reason: "RETENTION" | "CLOSURE" }> = {
  ABANDONED_DRAFT: { where: "s.status = 'DRAFT' AND s.updated_at < :cutoff", days: KYC_RETENTION.ABANDONED_DRAFT_DAYS, reason: "RETENTION" },
  REJECTED: { where: "s.status = 'REJECTED' AND s.decided_at < :cutoff", days: KYC_RETENTION.REJECTED_DAYS, reason: "RETENTION" },
  SELFIE_DECIDED: {
    where: "d.kind = 'SELFIE' AND s.status IN ('AUTO_APPROVED', 'APPROVED', 'SUSPENDED', 'REJECTED') AND s.decided_at < :cutoff",
    days: KYC_RETENTION.SELFIE_AFTER_DECISION_DAYS,
    reason: "RETENTION",
  },
  SUPERSEDED: {
    where: `s.status IN ('AUTO_APPROVED', 'APPROVED', 'SUSPENDED') AND s.decided_at < :cutoff
            AND a.current_submission_id IS DISTINCT FROM s.id`,
    days: KYC_RETENTION.SUPERSEDED_DAYS,
    reason: "RETENTION",
  },
  CLOSED_ACCOUNT: { where: "a.status = 'CLOSED' AND a.closed_at < :cutoff", days: KYC_RETENTION.CLOSED_ACCOUNT_DAYS, reason: "CLOSURE" },
};

/**
 * KYC step of the daily privacy retention (plan §2.14, ADR-0021). The
 * periods are `KYC_RETENTION`, proposed and pending the lawyer. Decisions,
 * checks, history and fingerprints (codes and HMACs, no image or datum in
 * clear) are not touched here. Each batch clears the keys and queues the
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
    const documentsErased = {} as Record<KycDocumentRule, number>;
    for (const rule of Object.keys(DOCUMENT_RULES) as KycDocumentRule[]) documentsErased[rule] = await this.purgeRule(rule, now);
    const identitiesErased = await this.eraseIdentities(now);
    const phoneCodesDeleted = await this.count(
      `DELETE FROM business.phone_verifications WHERE verified_at IS NULL AND created_at < :cutoff RETURNING 1`,
      { cutoff: new Date(now.getTime() - KYC_RETENTION.PHONE_CODE_DAYS * DAY_MS) },
    );
    return { documentsErased, identitiesErased, phoneCodesDeleted };
  }

  private async purgeRule(rule: KycDocumentRule, now: Date): Promise<number> {
    const { where, days, reason } = DOCUMENT_RULES[rule];
    const cutoff = new Date(now.getTime() - days * DAY_MS);
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

  /** The encrypted NIT, CI and phone of rejected attempts and closed accounts past their period. */
  private eraseIdentities(now: Date): Promise<number> {
    return this.count(
      `UPDATE business.kyc_submissions s SET nit_enc = NULL, rep_ci_enc = NULL, phone_enc = NULL, updated_at = :now
         FROM business.accounts a
        WHERE a.user_id = s.account_id
          AND (s.nit_enc IS NOT NULL OR s.rep_ci_enc IS NOT NULL OR s.phone_enc IS NOT NULL)
          AND ((s.status = 'REJECTED' AND s.decided_at < :rejectedCutoff) OR (a.status = 'CLOSED' AND a.closed_at < :closedCutoff))
       RETURNING 1`,
      {
        now,
        rejectedCutoff: new Date(now.getTime() - KYC_RETENTION.REJECTED_DAYS * DAY_MS),
        closedCutoff: new Date(now.getTime() - KYC_RETENTION.CLOSED_ACCOUNT_DAYS * DAY_MS),
      },
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

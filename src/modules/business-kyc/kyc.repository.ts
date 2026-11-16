import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { FingerprintKind } from "./kyc-cipher";
import { KycDocumentKind, KycPurpose, KycStatus } from "./kyc.catalog";
import type { CheckRecord } from "./kyc-pipeline.service";
import type { LegalKind } from "../business-accounts/business-accounts.schemas";

export type SubmissionRow = {
  id: string;
  accountId: string;
  version: number;
  purpose: KycPurpose;
  status: KycStatus;
  legalKind: LegalKind;
  tradeName: string | null;
  primaryCategoryId: string | null;
  legalName: string | null;
  nitMasked: string | null;
  nitEnc: Buffer | null;
  nitHmac: string | null;
  repFullName: string | null;
  repCiMasked: string | null;
  repCiEnc: Buffer | null;
  repCiHmac: string | null;
  repCiComplement: string | null;
  repCiExtension: string | null;
  phoneMasked: string | null;
  phoneEnc: Buffer | null;
  phoneHmac: string | null;
  phoneVerifiedAt: Date | null;
  specialty: string | null;
  address: string | null;
  seprecNumber: string | null;
  selfieChallengeCode: string | null;
  selfieChallengeExpiresAt: Date | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  reviewDueAt: Date | null;
  postReviewDueAt: Date | null;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  allowResubmit: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

const SUBMISSION_COLUMNS = `s.id, s.account_id AS "accountId", s.version, s.purpose, s.status, s.legal_kind AS "legalKind",
  s.trade_name AS "tradeName", s.primary_category_id AS "primaryCategoryId", s.legal_name AS "legalName",
  s.nit_masked AS "nitMasked", s.nit_enc AS "nitEnc", s.nit_hmac AS "nitHmac", s.rep_full_name AS "repFullName",
  s.rep_ci_masked AS "repCiMasked", s.rep_ci_enc AS "repCiEnc", s.rep_ci_hmac AS "repCiHmac",
  s.rep_ci_complement AS "repCiComplement", s.rep_ci_extension AS "repCiExtension",
  s.phone_masked AS "phoneMasked", s.phone_enc AS "phoneEnc", s.phone_hmac AS "phoneHmac",
  s.phone_verified_at AS "phoneVerifiedAt", s.specialty, s.address, s.seprec_number AS "seprecNumber",
  s.selfie_challenge_code AS "selfieChallengeCode", s.selfie_challenge_expires_at AS "selfieChallengeExpiresAt",
  s.submitted_at AS "submittedAt", s.decided_at AS "decidedAt", s.review_due_at AS "reviewDueAt",
  s.post_review_due_at AS "postReviewDueAt", s.claimed_by_user_id AS "claimedByUserId", s.claimed_at AS "claimedAt",
  s.allow_resubmit AS "allowResubmit", s.created_at AS "createdAt", s.updated_at AS "updatedAt"`;

/** Columns a draft save may write (snake_case in the table). */
export type SubmissionPatch = Partial<{
  trade_name: string | null;
  primary_category_id: string | null;
  legal_name: string | null;
  nit_masked: string | null;
  nit_enc: Buffer | null;
  nit_hmac: string | null;
  rep_full_name: string | null;
  rep_ci_masked: string | null;
  rep_ci_enc: Buffer | null;
  rep_ci_hmac: string | null;
  rep_ci_complement: string | null;
  rep_ci_extension: string | null;
  phone_masked: string | null;
  phone_enc: Buffer | null;
  phone_hmac: string | null;
  phone_verified_at: Date | null;
  specialty: string | null;
  address: string | null;
  seprec_number: string | null;
  selfie_challenge_code: string | null;
  selfie_challenge_expires_at: Date | null;
  status: KycStatus;
  submitted_at: Date;
  decided_at: Date;
  review_due_at: Date | null;
  post_review_due_at: Date | null;
  claimed_by_user_id: string | null;
  claimed_at: Date | null;
  allow_resubmit: boolean | null;
}>;

export type DocumentRow = {
  id: string;
  submissionId: string;
  kind: KycDocumentKind;
  storageKey: string | null;
  storageProvider: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  readable: boolean;
  readabilityCodes: string[];
  selfieChallengeCode: string | null;
  uploadedAt: Date;
  deletedAt: Date | null;
  deleteReason: string | null;
};

const DOCUMENT_COLUMNS = `d.id, d.submission_id AS "submissionId", d.kind, d.storage_key AS "storageKey",
  d.storage_provider AS "storageProvider", d.mime, d.size_bytes AS "sizeBytes", d.sha256, d.width, d.height,
  d.readable, d.readability_codes AS "readabilityCodes", d.selfie_challenge_code AS "selfieChallengeCode",
  d.uploaded_at AS "uploadedAt", d.deleted_at AS "deletedAt", d.delete_reason AS "deleteReason"`;

export type DecisionRow = {
  id: string;
  decision: string;
  actorUserId: string | null;
  reasonCodes: string[];
  note: string | null;
  allowResubmit: boolean | null;
  createdAt: Date;
};
export type HistoryRow = { fromStatus: KycStatus; toStatus: KycStatus; actorUserId: string | null; at: Date };
export type CheckRow = CheckRecord & { createdAt: Date };

@Injectable()
export class KycRepository {
  constructor(private readonly sequelize: Sequelize) {}

  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  async findSubmission(id: string, transaction?: Transaction, lock = false): Promise<SubmissionRow | null> {
    const [row] = await this.sequelize.query<SubmissionRow>(
      `SELECT ${SUBMISSION_COLUMNS} FROM business.kyc_submissions s WHERE s.id = :id${lock ? " FOR UPDATE" : ""}`,
      { type: QueryTypes.SELECT, replacements: { id }, transaction },
    );
    return row ?? null;
  }

  /** The attempt in flight (DRAFT, SUBMITTED, IN_REVIEW) of an account. */
  async findOpen(accountId: string, transaction?: Transaction, lock = false): Promise<SubmissionRow | null> {
    const [row] = await this.sequelize.query<SubmissionRow>(
      `SELECT ${SUBMISSION_COLUMNS} FROM business.kyc_submissions s
        WHERE s.account_id = :accountId AND s.status IN ('DRAFT', 'SUBMITTED', 'IN_REVIEW')${lock ? " FOR UPDATE" : ""}`,
      { type: QueryTypes.SELECT, replacements: { accountId }, transaction },
    );
    return row ?? null;
  }

  async findLatest(accountId: string, transaction?: Transaction): Promise<SubmissionRow | null> {
    const [row] = await this.sequelize.query<SubmissionRow>(
      `SELECT ${SUBMISSION_COLUMNS} FROM business.kyc_submissions s WHERE s.account_id = :accountId
        ORDER BY s.version DESC LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { accountId }, transaction },
    );
    return row ?? null;
  }

  /** Initial attempt plus resubmissions already sent (material changes do not count). */
  async countSentAttempts(accountId: string, transaction?: Transaction): Promise<number> {
    const [row] = await this.sequelize.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM business.kyc_submissions
        WHERE account_id = :accountId AND purpose IN ('INITIAL', 'RESUBMISSION') AND submitted_at IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: { accountId }, transaction },
    );
    return row?.count ?? 0;
  }

  async insertSubmission(
    input: { accountId: string; purpose: KycPurpose; legalKind: LegalKind; copyFrom: string | null },
    transaction: Transaction,
  ): Promise<string> {
    const copied = `trade_name, primary_category_id, legal_name, nit_masked, nit_enc, nit_hmac, rep_full_name, rep_ci_masked,
      rep_ci_enc, rep_ci_hmac, rep_ci_complement, rep_ci_extension, phone_masked, phone_enc, phone_hmac, phone_verified_at,
      specialty, address, seprec_number`;
    const [row] = await this.sequelize.query<{ id: string }>(
      input.copyFrom
        ? `INSERT INTO business.kyc_submissions (account_id, version, purpose, legal_kind, ${copied})
           SELECT :accountId, (SELECT COALESCE(max(version), 0) + 1 FROM business.kyc_submissions WHERE account_id = :accountId),
                  :purpose, :legalKind, ${copied}
             FROM business.kyc_submissions WHERE id = :copyFrom
           RETURNING id`
        : `INSERT INTO business.kyc_submissions (account_id, version, purpose, legal_kind)
           VALUES (:accountId, (SELECT COALESCE(max(version), 0) + 1 FROM business.kyc_submissions WHERE account_id = :accountId),
                   :purpose, :legalKind)
           RETURNING id`,
      { type: QueryTypes.SELECT, replacements: input, transaction },
    );
    return row.id;
  }

  async updateSubmission(id: string, patch: SubmissionPatch, transaction: Transaction): Promise<void> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([column]) => `${column} = :${column}`).join(", ");
    await this.sequelize.query(`UPDATE business.kyc_submissions SET ${sets}, updated_at = now() WHERE id = :id`, {
      replacements: { ...Object.fromEntries(entries), id },
      transaction,
    });
  }

  listDocuments(submissionId: string, transaction?: Transaction, includeDeleted = false): Promise<DocumentRow[]> {
    return this.sequelize.query<DocumentRow>(
      `SELECT ${DOCUMENT_COLUMNS} FROM business.kyc_documents d
        WHERE d.submission_id = :submissionId${includeDeleted ? "" : " AND d.deleted_at IS NULL"} ORDER BY d.uploaded_at`,
      { type: QueryTypes.SELECT, replacements: { submissionId }, transaction },
    );
  }

  async findDocument(submissionId: string, documentId: string, transaction?: Transaction): Promise<DocumentRow | null> {
    const [row] = await this.sequelize.query<DocumentRow>(
      `SELECT ${DOCUMENT_COLUMNS} FROM business.kyc_documents d WHERE d.id = :documentId AND d.submission_id = :submissionId`,
      { type: QueryTypes.SELECT, replacements: { submissionId, documentId }, transaction },
    );
    return row ?? null;
  }

  async insertDocument(
    input: Omit<DocumentRow, "id" | "uploadedAt" | "deletedAt" | "deleteReason" | "storageKey"> & { storageKey: string },
    transaction: Transaction,
  ): Promise<string> {
    const [row] = await this.sequelize.query<{ id: string }>(
      `INSERT INTO business.kyc_documents
         (submission_id, kind, storage_key, storage_provider, mime, size_bytes, sha256, width, height, readable,
          readability_codes, selfie_challenge_code)
       VALUES (:submissionId, :kind, :storageKey, :storageProvider, :mime, :sizeBytes, :sha256, :width, :height, :readable,
               CAST(:readabilityCodes AS text[]), :selfieChallengeCode)
       RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { ...input, readabilityCodes: textArray(input.readabilityCodes) }, transaction },
    );
    return row.id;
  }

  /** Clears the key and records why; returns the cleared rows for `media.release`. */
  async deleteDocuments(
    where: { submissionId: string; kinds?: readonly KycDocumentKind[]; documentId?: string },
    reason: "RETENTION" | "USER_REQUEST" | "CLOSURE" | "REPLACED",
    transaction: Transaction,
  ): Promise<{ id: string; storageKey: string; storageProvider: string }[]> {
    return this.sequelize.query<{ id: string; storageKey: string; storageProvider: string }>(
      `WITH target AS (
         SELECT id, storage_key FROM business.kyc_documents
          WHERE submission_id = :submissionId AND deleted_at IS NULL
            ${where.kinds ? "AND kind IN (:kinds)" : ""} ${where.documentId ? "AND id = :documentId" : ""}
          FOR UPDATE)
       UPDATE business.kyc_documents d SET storage_key = NULL, deleted_at = now(), delete_reason = :reason
         FROM target WHERE d.id = target.id
       RETURNING d.id, target.storage_key AS "storageKey", d.storage_provider AS "storageProvider"`,
      {
        type: QueryTypes.SELECT,
        replacements: { submissionId: where.submissionId, kinds: where.kinds ?? null, documentId: where.documentId ?? null, reason },
        transaction,
      },
    );
  }

  /**
   * A new version starts with the previous one's documents (same stored files,
   * refcounted). A resubmission leaves the selfie out: it needs a fresh gesture.
   */
  async copyDocuments(fromSubmissionId: string, toSubmissionId: string, includeSelfie: boolean, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO business.kyc_documents
         (submission_id, kind, storage_key, storage_provider, mime, size_bytes, sha256, width, height, readable,
          readability_codes, selfie_challenge_code, uploaded_at)
       SELECT :toSubmissionId, kind, storage_key, storage_provider, mime, size_bytes, sha256, width, height, readable,
              readability_codes, selfie_challenge_code, uploaded_at
         FROM business.kyc_documents
        WHERE submission_id = :fromSubmissionId AND deleted_at IS NULL AND (:includeSelfie OR kind <> 'SELFIE')`,
      { replacements: { fromSubmissionId, toSubmissionId, includeSelfie }, transaction },
    );
  }

  async insertChecks(submissionId: string, records: readonly CheckRecord[], transaction: Transaction): Promise<void> {
    for (const record of records) {
      await this.sequelize.query(
        `INSERT INTO business.kyc_checks (submission_id, code, outcome, detail, duration_ms, created_at)
         VALUES (:submissionId, :code, :outcome, CAST(:detail AS jsonb), :durationMs, clock_timestamp())`,
        { replacements: { submissionId, ...record, detail: JSON.stringify(record.detail) }, transaction },
      );
    }
  }

  listChecks(submissionId: string): Promise<CheckRow[]> {
    return this.sequelize.query<CheckRow>(
      `SELECT code, outcome, detail, duration_ms AS "durationMs", created_at AS "createdAt"
         FROM business.kyc_checks WHERE submission_id = :submissionId ORDER BY created_at, id`,
      { type: QueryTypes.SELECT, replacements: { submissionId } },
    );
  }

  async insertDecision(
    input: { submissionId: string; decision: string; actorUserId: string | null; reasonCodes: readonly string[]; note: string | null; allowResubmit: boolean | null },
    transaction: Transaction,
  ): Promise<string> {
    const [row] = await this.sequelize.query<{ id: string }>(
      `INSERT INTO business.kyc_decisions (submission_id, decision, actor_user_id, reason_codes, note, allow_resubmit, created_at)
       VALUES (:submissionId, :decision, :actorUserId, CAST(:reasonCodes AS text[]), :note, :allowResubmit, clock_timestamp())
       RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { ...input, reasonCodes: textArray(input.reasonCodes) }, transaction },
    );
    return row.id;
  }

  listDecisions(submissionId: string): Promise<DecisionRow[]> {
    return this.sequelize.query<DecisionRow>(
      `SELECT id, decision, actor_user_id AS "actorUserId", reason_codes AS "reasonCodes", note,
              allow_resubmit AS "allowResubmit", created_at AS "createdAt"
         FROM business.kyc_decisions WHERE submission_id = :submissionId ORDER BY created_at, id`,
      { type: QueryTypes.SELECT, replacements: { submissionId } },
    );
  }

  async latestHumanDecision(submissionId: string): Promise<DecisionRow | null> {
    const [row] = await this.sequelize.query<DecisionRow>(
      `SELECT id, decision, actor_user_id AS "actorUserId", reason_codes AS "reasonCodes", note,
              allow_resubmit AS "allowResubmit", created_at AS "createdAt"
         FROM business.kyc_decisions WHERE submission_id = :submissionId AND decision IN ('APPROVE', 'REJECT', 'POST_REVIEW_OK')
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { submissionId } },
    );
    return row ?? null;
  }

  async insertHistory(
    input: { accountId: string; submissionId: string; from: KycStatus; to: KycStatus; decisionId: string | null; actorUserId: string | null },
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      // clock_timestamp(): several rows of one transaction keep their real order (now() is the transaction start).
      `INSERT INTO business.kyc_status_history (account_id, submission_id, from_status, to_status, decision_id, actor_user_id, at)
       VALUES (:accountId, :submissionId, :from, :to, :decisionId, :actorUserId, clock_timestamp())`,
      { replacements: input, transaction },
    );
  }

  listHistory(submissionId: string): Promise<HistoryRow[]> {
    return this.sequelize.query<HistoryRow>(
      `SELECT from_status AS "fromStatus", to_status AS "toStatus", actor_user_id AS "actorUserId", at
         FROM business.kyc_status_history WHERE submission_id = :submissionId ORDER BY at, id`,
      { type: QueryTypes.SELECT, replacements: { submissionId } },
    );
  }

  /** Serializes every submit that shares one identity datum, across instances (released at commit). */
  async lockFingerprints(hmacs: readonly string[], transaction: Transaction): Promise<void> {
    for (const hmac of [...new Set(hmacs)].sort()) {
      await this.sequelize.query("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))", {
        replacements: { key: `kyc:${hmac}` },
        transaction,
      });
    }
  }

  async recordFingerprints(accountId: string, fingerprints: Partial<Record<FingerprintKind, string>>, transaction: Transaction): Promise<void> {
    for (const [kind, hmac] of Object.entries(fingerprints)) {
      if (!hmac) continue;
      await this.sequelize.query(
        `INSERT INTO business.identity_fingerprints (account_id, kind, hmac) VALUES (:accountId, :kind, :hmac)
         ON CONFLICT (account_id, kind, hmac) WHERE revoked_at IS NULL DO NOTHING`,
        { replacements: { accountId, kind, hmac }, transaction },
      );
    }
  }
}

/** Postgres array literal of plain codes (`[A-Z0-9_]` only, so nothing needs quoting). */
function textArray(values: readonly string[]): string {
  return `{${values.filter((value) => /^[A-Z0-9_]+$/u.test(value)).join(",")}}`;
}

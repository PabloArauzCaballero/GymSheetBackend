import { QueryTypes } from "sequelize";
import { env } from "../../config/env";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const KYC_STATUSES = `'DRAFT', 'SUBMITTED', 'AUTO_APPROVED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'SUPERSEDED'`;
const FINGERPRINT_KINDS = `'NIT', 'CI', 'PHONE', 'EMAIL'`;
const PREVIOUS_CONSENT_KINDS = `'HEALTH', 'ORIENTATION', 'VERIFICATION_SELFIE', 'PRECISE_LOCATION'`;
const HMAC = "~ '^[0-9a-f]{64}$'";

/**
 * Franja 8b (ADR-0021): KYC of business accounts.
 *
 * 1. `business.kyc_submissions`: one row per attempt (`version`), never
 *    rewritten once decided. NIT, CI and phone are stored encrypted
 *    (`KycCipher`) plus their keyed HMAC (privacy pepper) for duplicates and
 *    the blocklist; only a masked form is readable without the key.
 * 2. `business.kyc_documents`: encrypted files under
 *    `business/{accountId}/kyc/{submissionId}/{uuid}.bin`, with the
 *    readability measured at upload; deletion clears the key and records why.
 * 3. Append-only `kyc_checks`, `kyc_decisions` and `kyc_status_history`.
 * 4. `phone_verifications` (OTP by WhatsApp), `identity_fingerprints`,
 *    `blocklist` and `banned_terms` (REPP).
 * 5. `business.accounts.current_submission_id`; the `KYC_SELFIE` consent; a
 *    trigram index for the name-similarity check over public listings.
 *
 * Rollback: every KYC file still stored is queued on `media.release` (the
 * outbox survives the drop and the release check tolerates the missing
 * table), then the tables, the column, the index and the consent kind go.
 * Consent rows of `KYC_SELFIE` are deleted: the datum they covered is gone.
 * `business.accounts.kyc_status`, listings and handles keep their state: a
 * business approved before the rollback stays published.
 */
const upStatements = [
  `CREATE TABLE business.kyc_submissions (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     account_id uuid NOT NULL REFERENCES business.accounts(user_id) ON DELETE RESTRICT,
     version integer NOT NULL CHECK (version >= 1),
     purpose varchar(16) NOT NULL DEFAULT 'INITIAL' CHECK (purpose IN ('INITIAL', 'RESUBMISSION', 'MATERIAL_CHANGE')),
     status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (${KYC_STATUSES})),
     legal_kind varchar(12) NOT NULL CHECK (legal_kind IN ('COMPANY', 'INDIVIDUAL')),
     trade_name varchar(180),
     primary_category_id uuid REFERENCES directory.categories(id) ON DELETE SET NULL,
     legal_name varchar(200),
     nit_masked varchar(24),
     nit_enc bytea,
     nit_hmac varchar(64) CHECK (nit_hmac IS NULL OR nit_hmac ${HMAC}),
     rep_full_name varchar(180),
     rep_ci_masked varchar(24),
     rep_ci_enc bytea,
     rep_ci_hmac varchar(64) CHECK (rep_ci_hmac IS NULL OR rep_ci_hmac ${HMAC}),
     rep_ci_complement varchar(2),
     rep_ci_extension varchar(2),
     phone_masked varchar(24),
     phone_enc bytea,
     phone_hmac varchar(64) CHECK (phone_hmac IS NULL OR phone_hmac ${HMAC}),
     phone_verified_at timestamptz,
     specialty varchar(120),
     address varchar(500),
     seprec_number varchar(40),
     selfie_challenge_code varchar(30),
     selfie_challenge_expires_at timestamptz,
     submitted_at timestamptz,
     decided_at timestamptz,
     review_due_at timestamptz,
     post_review_due_at timestamptz,
     claimed_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     claimed_at timestamptz,
     allow_resubmit boolean,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_kyc_submissions_version UNIQUE (account_id, version),
     CONSTRAINT ck_kyc_submissions_submitted CHECK (status = 'DRAFT' OR submitted_at IS NOT NULL)
   )`,
  // At most one attempt in flight per account (being edited, submitted or waiting for REPP).
  `CREATE UNIQUE INDEX ux_kyc_submissions_open ON business.kyc_submissions (account_id)
     WHERE status IN ('DRAFT', 'SUBMITTED', 'IN_REVIEW')`,
  // The two REPP queues, oldest due first.
  `CREATE INDEX ix_kyc_submissions_review_queue ON business.kyc_submissions (review_due_at, id) WHERE status = 'IN_REVIEW'`,
  `CREATE INDEX ix_kyc_submissions_post_review_queue ON business.kyc_submissions (post_review_due_at, id)
     WHERE status = 'AUTO_APPROVED'`,
  `CREATE INDEX ix_kyc_submissions_retention ON business.kyc_submissions (status, decided_at)`,

  `ALTER TABLE business.accounts
     ADD COLUMN current_submission_id uuid REFERENCES business.kyc_submissions(id) ON DELETE SET NULL`,

  `CREATE TABLE business.kyc_documents (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     submission_id uuid NOT NULL REFERENCES business.kyc_submissions(id) ON DELETE RESTRICT,
     kind varchar(10) NOT NULL CHECK (kind IN ('CI_FRONT', 'CI_BACK', 'SELFIE', 'SEPREC')),
     storage_key varchar(1024),
     storage_provider varchar(40) NOT NULL,
     mime varchar(40) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
     size_bytes integer NOT NULL CHECK (size_bytes > 0),
     sha256 varchar(64) NOT NULL CHECK (sha256 ${HMAC}),
     width integer,
     height integer,
     readable boolean NOT NULL,
     readability_codes text[] NOT NULL DEFAULT '{}',
     selfie_challenge_code varchar(30),
     uploaded_at timestamptz NOT NULL DEFAULT now(),
     deleted_at timestamptz,
     delete_reason varchar(16) CHECK (delete_reason IN ('RETENTION', 'USER_REQUEST', 'CLOSURE', 'REPLACED')),
     CONSTRAINT ck_kyc_documents_deleted CHECK ((deleted_at IS NULL) = (storage_key IS NOT NULL)),
     CONSTRAINT ck_kyc_documents_delete_reason CHECK ((deleted_at IS NULL) = (delete_reason IS NULL)),
     CONSTRAINT ck_kyc_documents_selfie CHECK ((kind = 'SELFIE') = (selfie_challenge_code IS NOT NULL))
   )`,
  `CREATE UNIQUE INDEX ux_kyc_documents_live_kind ON business.kyc_documents (submission_id, kind) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_kyc_documents_storage_key ON business.kyc_documents (storage_key) WHERE storage_key IS NOT NULL`,

  `CREATE TABLE business.kyc_checks (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     submission_id uuid NOT NULL REFERENCES business.kyc_submissions(id) ON DELETE RESTRICT,
     code varchar(40) NOT NULL,
     outcome varchar(5) NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'WARN', 'ERROR')),
     detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
     duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_kyc_checks_submission ON business.kyc_checks (submission_id, created_at)`,

  `CREATE TABLE business.kyc_decisions (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     submission_id uuid NOT NULL REFERENCES business.kyc_submissions(id) ON DELETE RESTRICT,
     decision varchar(16) NOT NULL
       CHECK (decision IN ('AUTO_APPROVE', 'ROUTE_TO_REVIEW', 'APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE', 'POST_REVIEW_OK')),
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     reason_codes text[] NOT NULL DEFAULT '{}',
     note varchar(1000),
     allow_resubmit boolean,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_kyc_decisions_submission ON business.kyc_decisions (submission_id, created_at)`,

  `CREATE TABLE business.kyc_status_history (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     account_id uuid NOT NULL REFERENCES business.accounts(user_id) ON DELETE RESTRICT,
     submission_id uuid NOT NULL REFERENCES business.kyc_submissions(id) ON DELETE RESTRICT,
     from_status varchar(16) NOT NULL CHECK (from_status IN (${KYC_STATUSES})),
     to_status varchar(16) NOT NULL CHECK (to_status IN (${KYC_STATUSES})),
     decision_id uuid REFERENCES business.kyc_decisions(id) ON DELETE RESTRICT,
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_kyc_status_history_account ON business.kyc_status_history (account_id, at)`,

  `CREATE TABLE business.phone_verifications (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     account_id uuid NOT NULL REFERENCES business.accounts(user_id) ON DELETE RESTRICT,
     phone_hmac varchar(64) NOT NULL CHECK (phone_hmac ${HMAC}),
     phone_enc bytea NOT NULL,
     phone_masked varchar(24) NOT NULL,
     code_hash varchar(64) CHECK (code_hash IS NULL OR code_hash ${HMAC}),
     attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
     expires_at timestamptz,
     verified_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_phone_verifications_account ON business.phone_verifications (account_id, created_at DESC)`,

  `CREATE TABLE business.identity_fingerprints (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     account_id uuid NOT NULL REFERENCES business.accounts(user_id) ON DELETE RESTRICT,
     kind varchar(8) NOT NULL CHECK (kind IN (${FINGERPRINT_KINDS})),
     hmac varchar(64) NOT NULL CHECK (hmac ${HMAC}),
     created_at timestamptz NOT NULL DEFAULT now(),
     revoked_at timestamptz
   )`,
  `CREATE UNIQUE INDEX ux_identity_fingerprints_live ON business.identity_fingerprints (account_id, kind, hmac)
     WHERE revoked_at IS NULL`,
  `CREATE INDEX ix_identity_fingerprints_lookup ON business.identity_fingerprints (kind, hmac) WHERE revoked_at IS NULL`,

  `CREATE TABLE business.blocklist (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     kind varchar(8) NOT NULL CHECK (kind IN (${FINGERPRINT_KINDS})),
     hmac varchar(64) NOT NULL CHECK (hmac ${HMAC}),
     reason_code varchar(40) NOT NULL,
     created_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz,
     removed_at timestamptz,
     removed_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL
   )`,
  `CREATE UNIQUE INDEX ux_blocklist_live ON business.blocklist (kind, hmac) WHERE removed_at IS NULL`,

  `CREATE TABLE business.banned_terms (
     term varchar(80) PRIMARY KEY CHECK (term = lower(term) AND char_length(term) >= 2),
     scope varchar(8) NOT NULL CHECK (scope IN ('NAME', 'LISTING', 'BOTH')),
     created_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `ALTER TABLE auth.consents DROP CONSTRAINT IF EXISTS ck_consents_kind`,
  `ALTER TABLE auth.consents
     ADD CONSTRAINT ck_consents_kind CHECK (kind IN (${PREVIOUS_CONSENT_KINDS}, 'KYC_SELFIE'))`,

  // NAME_SIMILARITY: trigram probe over public listings (`%` uses it, then the exact threshold filters).
  `CREATE INDEX ix_directory_entities_active_name_trgm ON directory.entities
     USING gin (public.repp_normalize(name) public.gin_trgm_ops) WHERE status = 'ACTIVE'`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS directory.ix_directory_entities_active_name_trgm`,
  `DELETE FROM auth.consents WHERE kind = 'KYC_SELFIE'`,
  `ALTER TABLE auth.consents DROP CONSTRAINT IF EXISTS ck_consents_kind`,
  `ALTER TABLE auth.consents ADD CONSTRAINT ck_consents_kind CHECK (kind IN (${PREVIOUS_CONSENT_KINDS}))`,
  `DROP TABLE IF EXISTS business.banned_terms`,
  `DROP TABLE IF EXISTS business.blocklist`,
  `DROP TABLE IF EXISTS business.identity_fingerprints`,
  `DROP TABLE IF EXISTS business.phone_verifications`,
  `DROP TABLE IF EXISTS business.kyc_status_history`,
  `DROP TABLE IF EXISTS business.kyc_decisions`,
  `DROP TABLE IF EXISTS business.kyc_checks`,
  `DROP TABLE IF EXISTS business.kyc_documents`,
  `ALTER TABLE business.accounts DROP COLUMN IF EXISTS current_submission_id`,
  `DROP TABLE IF EXISTS business.kyc_submissions`,
] as const;

export const businessKycMigration: DatabaseMigration = {
  id: "202611200501-business-kyc",
  description:
    "Business KYC (ADR-0021): encrypted submissions and documents, append-only checks, decisions and history, phone OTP, identity fingerprints, blocklist, banned terms and the KYC_SELFIE consent.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: async (queryInterface, transaction) => {
    // Nothing stored may be forgotten: every remaining file is queued for real deletion first.
    const files = await queryInterface.sequelize.query<{ id: string; key: string; provider: string }>(
      `SELECT id::text AS id, storage_key AS key, storage_provider AS provider
         FROM business.kyc_documents WHERE storage_key IS NOT NULL`,
      { type: QueryTypes.SELECT, transaction },
    );
    for (const file of files) {
      await queryInterface.sequelize.query(
        `INSERT INTO integration.outbox_jobs
           (id, queue_name, event_type, aggregate_type, aggregate_id, deduplication_key, payload, status,
            attempt_count, max_attempts, available_at, created_at, updated_at)
         VALUES (uuid_generate_v4(), 'media.release', 'media.file-release-requested.v1', 'business.kyc_documents', CAST(:id AS uuid),
                 :dedup, CAST(:payload AS jsonb), 'PENDING', 0, 8, now(), now(), now())
         ON CONFLICT DO NOTHING`,
        {
          replacements: {
            id: file.id,
            dedup: `media-release:business.kyc_documents:${file.id}:${file.key}`,
            payload: JSON.stringify({ schemaVersion: 1, provider: file.provider || env.MEDIA_STORAGE_PROVIDER, storageKey: file.key }),
          },
          transaction,
        },
      );
    }
    await executeSqlStatements(queryInterface, transaction, downStatements);
  },
};

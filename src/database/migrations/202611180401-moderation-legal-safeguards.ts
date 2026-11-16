import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Moderation and legal safeguards promised by the legal texts.
 *
 * 1. `auth.terms_acceptances` accepts the COMMUNITY document (community rules).
 * 2. `social.discovery_passes.origin`: the implicit pass a report creates is
 *    'REPORT' and never shows in the reported person's passes-received. Passes
 *    created by a report before this column existed (same pair, within a few
 *    seconds of the report) are backfilled as 'REPORT'.
 * 3. `moderation.reports.resolution` admits MENOR_CONFIRMADO (a moderator
 *    confirmed the account belongs to a minor).
 * 4. `moderation.chat_message_evidence`: a copy of a reported chat message, so
 *    "delete for everyone" or the disappearing purge does not destroy the
 *    evidence. It is deleted RETENTION days after every report on the message
 *    is closed. No foreign keys on purpose: the copy must outlive the message
 *    row (purged or emptied) and the account closure, as `moderation.reports`
 *    does.
 * 5. `moderation.auto_hide_reviews`: one review item per content hidden by the
 *    distinct-reporters threshold, closed by the moderator's decision.
 *
 * Rollback drops the new tables and column. Acceptance and report history is
 * append-only, so the previous CHECKs come back NOT VALID: existing COMMUNITY
 * acceptances and MENOR_CONFIRMADO resolutions stay, new rows obey the old rule.
 * Dropping the evidence table on rollback deletes the evidence copies.
 */
const upStatements = [
  `ALTER TABLE auth.terms_acceptances DROP CONSTRAINT ck_terms_acceptances_document`,
  `ALTER TABLE auth.terms_acceptances ADD CONSTRAINT ck_terms_acceptances_document
     CHECK (document IN ('TERMS', 'PRIVACY', 'COMMUNITY'))`,
  `ALTER TABLE social.discovery_passes ADD COLUMN origin varchar(10) NOT NULL DEFAULT 'SWIPE'`,
  `ALTER TABLE social.discovery_passes ADD CONSTRAINT ck_discovery_passes_origin
     CHECK (origin IN ('SWIPE', 'REPORT'))`,
  `UPDATE social.discovery_passes pass SET origin = 'REPORT'
    WHERE EXISTS (
      SELECT 1 FROM moderation.reports report
       WHERE report.reporter_user_id = pass.viewer_id
         AND report.reported_user_id = pass.target_id
         AND pass.created_at BETWEEN report.created_at - interval '5 seconds'
                                 AND report.created_at + interval '5 seconds')`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_resolution`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_resolution
     CHECK (resolution IS NULL OR resolution IN
            ('SIN_ACCION', 'CONTENIDO_OCULTO', 'USUARIO_ADVERTIDO',
             'USUARIO_SUSPENDIDO', 'USUARIO_EXPULSADO', 'MENOR_CONFIRMADO'))`,
  `CREATE TABLE moderation.chat_message_evidence (
     message_id uuid PRIMARY KEY,
     conversation_id uuid NOT NULL,
     sender_id uuid NOT NULL,
     type varchar(12) NOT NULL,
     body text NULL,
     media_provider varchar(20) NULL,
     media_key text NULL,
     media_mime_type varchar(100) NULL,
     media_size_bytes integer NULL,
     location_lat double precision NULL,
     location_lng double precision NULL,
     location_label varchar(180) NULL,
     reply_to_id uuid NULL,
     forwarded boolean NOT NULL DEFAULT false,
     sent_at timestamptz NOT NULL,
     edited_at timestamptz NULL,
     expires_at timestamptz NULL,
     captured_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE moderation.auto_hide_reviews (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     tenant_id varchar(60) NOT NULL,
     target_kind varchar(20) NOT NULL,
     target_id uuid NOT NULL,
     author_user_id uuid NOT NULL,
     reason varchar(30) NOT NULL,
     distinct_reporters integer NOT NULL CHECK (distinct_reporters > 0),
     hidden_at timestamptz NOT NULL DEFAULT now(),
     reviewed_at timestamptz NULL,
     reviewed_by_user_id uuid NULL,
     outcome varchar(20) NULL,
     CONSTRAINT ck_auto_hide_reviews_outcome CHECK (outcome IS NULL OR outcome IN ('RESTORED', 'KEPT_HIDDEN')),
     CONSTRAINT ck_auto_hide_reviews_complete CHECK ((reviewed_at IS NULL) = (outcome IS NULL))
   )`,
  // One open review per content; the moderation queue probes it per case.
  `CREATE UNIQUE INDEX uq_auto_hide_reviews_open
     ON moderation.auto_hide_reviews (target_kind, target_id) WHERE reviewed_at IS NULL`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS moderation.auto_hide_reviews`,
  `DROP TABLE IF EXISTS moderation.chat_message_evidence`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_resolution`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_resolution
     CHECK (resolution IS NULL OR resolution IN
            ('SIN_ACCION', 'CONTENIDO_OCULTO', 'USUARIO_ADVERTIDO',
             'USUARIO_SUSPENDIDO', 'USUARIO_EXPULSADO')) NOT VALID`,
  `ALTER TABLE social.discovery_passes DROP CONSTRAINT IF EXISTS ck_discovery_passes_origin`,
  `ALTER TABLE social.discovery_passes DROP COLUMN IF EXISTS origin`,
  `ALTER TABLE auth.terms_acceptances DROP CONSTRAINT ck_terms_acceptances_document`,
  `ALTER TABLE auth.terms_acceptances ADD CONSTRAINT ck_terms_acceptances_document
     CHECK (document IN ('TERMS', 'PRIVACY')) NOT VALID`,
] as const;

export const moderationLegalSafeguardsMigration: DatabaseMigration = {
  id: "202611180401-moderation-legal-safeguards",
  description:
    "Adds the COMMUNITY legal document, hidden report passes, MENOR_CONFIRMADO, chat message evidence and auto-hide review items.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

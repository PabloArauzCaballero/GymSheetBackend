import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * A reporter can withdraw their own report. The row is never deleted (it is the
 * moderation record): `withdrawn_at` marks it, and an open report also moves to
 * status RETIRADO so it leaves the queue and the open-report unique index
 * (`uq_moderation_report_open`), which lets the same person report again.
 * A report a moderator already closed keeps its RESUELTO/DESCARTADO status and
 * resolution; only `withdrawn_at` is set, so the outcome stands.
 */
const upStatements = [
  `ALTER TABLE moderation.reports ADD COLUMN withdrawn_at timestamptz`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_status`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_status
     CHECK (status IN ('PENDIENTE', 'EN_REVISION', 'RESUELTO', 'DESCARTADO', 'RETIRADO'))`,
  // RETIRADO always says when; a withdrawal never carries a moderator's resolution.
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_withdrawn
     CHECK (status <> 'RETIRADO' OR (withdrawn_at IS NOT NULL AND resolution IS NULL))`,
  // «Tus denuncias»: the reporter's live reports, newest first.
  `CREATE INDEX ix_moderation_reports_reporter_live
     ON moderation.reports (reporter_user_id, created_at DESC, id DESC)
   WHERE withdrawn_at IS NULL`,
] as const;

const downStatements = [
  // Rolling back would make withdrawn reports hide content again and lose who
  // withdrew what; refuse instead of dropping that silently.
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM moderation.reports WHERE withdrawn_at IS NOT NULL) THEN
       RAISE EXCEPTION 'Cannot roll back report withdrawal while withdrawn reports exist';
     END IF;
   END
   $$`,
  `DROP INDEX IF EXISTS moderation.ix_moderation_reports_reporter_live`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_withdrawn`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT ck_moderation_report_status`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_status
     CHECK (status IN ('PENDIENTE', 'EN_REVISION', 'RESUELTO', 'DESCARTADO'))`,
  `ALTER TABLE moderation.reports DROP COLUMN IF EXISTS withdrawn_at`,
] as const;

export const moderationReportWithdrawalMigration: DatabaseMigration = {
  id: "202611160002-moderation-report-withdrawal",
  description: "Lets reporters withdraw their own reports (withdrawn_at, RETIRADO status) without deleting the record.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

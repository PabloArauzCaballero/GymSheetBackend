import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Lists hide every routine the viewer reported, in any status
 * (`training/routine-discovery.ts`). `uq_moderation_report_open` only covers
 * open reports, so this full index serves that per-viewer anti-join.
 * moderation.reports is small; a plain CREATE INDEX inside the migration
 * transaction is acceptable.
 */
const upStatements = [
  `CREATE INDEX IF NOT EXISTS ix_moderation_reports_reporter_target
     ON moderation.reports (reporter_user_id, target_kind, target_id)`,
] as const;

const downStatements = [`DROP INDEX IF EXISTS moderation.ix_moderation_reports_reporter_target`] as const;

export const moderationReportsReporterIndexMigration: DatabaseMigration = {
  id: "202611160001-moderation-reports-reporter-index",
  description: "Indexes moderation.reports by reporter and target so lists can hide what the viewer reported.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

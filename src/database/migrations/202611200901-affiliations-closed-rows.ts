import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 7b, data minimisation (ADR-0025 §13): the three CI digits exist only
 * while the gym decides a request or keeps the member. A row that is closed
 * (rejected, cancelled, ended) loses them, and the database holds it.
 *
 * Rollback: the CHECK goes; the digits erased by the backfill are not
 * restored (they are gone on purpose, and nothing reads them on a closed row).
 */
const upStatements = [
  `UPDATE directory.affiliations SET ci_last3 = NULL
    WHERE status NOT IN ('REQUESTED', 'CONFIRMED') AND ci_last3 IS NOT NULL`,
  `ALTER TABLE directory.affiliations
     ADD CONSTRAINT ck_affiliations_ci_closed CHECK (status IN ('REQUESTED', 'CONFIRMED') OR ci_last3 IS NULL)`,
] as const;

const downStatements = [`ALTER TABLE directory.affiliations DROP CONSTRAINT IF EXISTS ck_affiliations_ci_closed`] as const;

export const affiliationsClosedRowsMigration: DatabaseMigration = {
  id: "202611200901-affiliations-closed-rows",
  description: "Affiliations (ADR-0025): a closed affiliation keeps no CI digits (backfill and CHECK).",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

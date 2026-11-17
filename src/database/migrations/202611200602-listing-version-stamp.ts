import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 8c (ADR-0022 §10): `directory.entity_plans.updated_at` becomes the
 * listing's version stamp. REPP releases a held listing only against the stamp
 * it reviewed, so every UPDATE must move it, whoever writes: the ORM, raw SQL,
 * a later franja (stock reservations, 8d). A trigger sets it to
 * `clock_timestamp()` (not `now()`), so two updates in one transaction still
 * get different stamps.
 *
 * Rollback: drop the trigger and its function; `updated_at` goes back to
 * whatever each writer sets.
 */
const upStatements = [
  `CREATE OR REPLACE FUNCTION directory.entity_plans_touch_updated_at() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       NEW.updated_at := clock_timestamp();
       RETURN NEW;
     END $$`,
  `CREATE TRIGGER trg_entity_plans_touch_updated_at BEFORE UPDATE ON directory.entity_plans
     FOR EACH ROW EXECUTE FUNCTION directory.entity_plans_touch_updated_at()`,
] as const;

const downStatements = [
  `DROP TRIGGER IF EXISTS trg_entity_plans_touch_updated_at ON directory.entity_plans`,
  `DROP FUNCTION IF EXISTS directory.entity_plans_touch_updated_at()`,
] as const;

export const listingVersionStampMigration: DatabaseMigration = {
  id: "202611200602-listing-version-stamp",
  description: "Every update of a listing moves its updated_at (clock_timestamp), the version REPP releases against (ADR-0022).",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

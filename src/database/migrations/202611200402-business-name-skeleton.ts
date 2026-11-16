import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 8a (ADR-0020): the commercial name of a business is material.
 *
 * `directory.business_name_skeleton(text)` folds a name the way a handle is
 * folded (`public.repp_normalize`, separators dropped, confusables
 * `0→o 1→l i→l 5→s 3→e`), so `Top Fit`, `TOP-FIT` and `T0p Fit` collide. It is
 * IMMUTABLE so a partial index over the public listings can serve the lookup
 * that refuses a name too similar to another listing of the same type.
 */
const upStatements = [
  `CREATE OR REPLACE FUNCTION directory.business_name_skeleton(input text) RETURNS text
     LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
       SELECT translate(replace(public.repp_normalize(input), ' ', ''), '01i53', 'ollse')
     $$`,
  `CREATE INDEX ix_directory_entities_active_name_skeleton
     ON directory.entities (entity_type, directory.business_name_skeleton(name))
     WHERE status = 'ACTIVE'`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS directory.ix_directory_entities_active_name_skeleton`,
  `DROP FUNCTION IF EXISTS directory.business_name_skeleton(text)`,
] as const;

export const businessNameSkeletonMigration: DatabaseMigration = {
  id: "202611200402-business-name-skeleton",
  description: "Skeleton of business names and its partial index over public listings (anti-impersonation).",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

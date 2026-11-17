import { QueryInterface, QueryTypes, Transaction } from "sequelize";
import { businessNameSkeleton, handleSkeleton } from "../../modules/business-accounts/handle-rules";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 8a (ADR-0020), security review of 77f33a7: one fold, in one place.
 *
 * The SQL `directory.business_name_skeleton` and the JS fold could disagree,
 * and a name that folds differently on each side dodged the look-alike check.
 * The skeleton is now computed only by the application and stored:
 * `directory.entities.name_skeleton` (written by the model hook on every
 * create and rename) and `directory.handles.skeleton`, recomputed here because
 * the fold gained `rn→m` and `vv→w`. Lookups compare stored values.
 *
 * Down restores the SQL function, its expression index and the previous
 * handle fold (`translate`, exact for the ASCII handle alphabet).
 */
const BATCH_SIZE = 500;

type Row = { key: string; value: string; skeleton: string | null };

/** Recomputes a stored skeleton column in bounded batches, only where it changed. */
async function refold(
  queryInterface: QueryInterface,
  transaction: Transaction,
  target: { table: string; key: string; value: string; column: string; cast: string },
  fold: (value: string) => string,
): Promise<void> {
  const { table, key, value, column, cast } = target;
  let after: string | null = null;
  for (;;) {
    const rows: Row[] = await queryInterface.sequelize.query<Row>(
      `SELECT ${key}::text AS key, ${value} AS value, ${column} AS skeleton FROM ${table}
        WHERE (CAST(:after AS text) IS NULL OR ${key}::text > :after) ORDER BY ${key}::text LIMIT ${BATCH_SIZE}`,
      { replacements: { after }, type: QueryTypes.SELECT, transaction },
    );
    if (rows.length === 0) return;
    const changed = rows.filter((row) => fold(row.value) !== row.skeleton);
    if (changed.length > 0) {
      await queryInterface.sequelize.query(
        `UPDATE ${table} t SET ${column} = s.skeleton
           FROM unnest(ARRAY[:keys]::text[], ARRAY[:skeletons]::text[]) AS s(key, skeleton)
          WHERE t.${key} = s.key::${cast}`,
        { replacements: { keys: changed.map((row) => row.key), skeletons: changed.map((row) => fold(row.value)) }, transaction },
      );
    }
    after = rows[rows.length - 1].key;
  }
}

const upAfterBackfill = [
  `ALTER TABLE directory.entities ALTER COLUMN name_skeleton SET NOT NULL`,
  `DROP INDEX IF EXISTS directory.ix_directory_entities_active_name_skeleton`,
  `CREATE INDEX ix_directory_entities_active_name_skeleton
     ON directory.entities (entity_type, name_skeleton) WHERE status = 'ACTIVE'`,
  `DROP FUNCTION IF EXISTS directory.business_name_skeleton(text)`,
] as const;

const downStatements = [
  `UPDATE directory.handles SET skeleton = translate(replace(replace(handle, '.', ''), '_', ''), '01i53', 'ollse')`,
  `CREATE OR REPLACE FUNCTION directory.business_name_skeleton(input text) RETURNS text
     LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
       SELECT translate(replace(public.repp_normalize(input), ' ', ''), '01i53', 'ollse')
     $$`,
  `DROP INDEX IF EXISTS directory.ix_directory_entities_active_name_skeleton`,
  `CREATE INDEX ix_directory_entities_active_name_skeleton
     ON directory.entities (entity_type, directory.business_name_skeleton(name))
     WHERE status = 'ACTIVE'`,
  `ALTER TABLE directory.entities DROP COLUMN IF EXISTS name_skeleton`,
] as const;

export const storedNameSkeletonMigration: DatabaseMigration = {
  id: "202611200403-stored-name-skeleton",
  description: "Store the application-folded skeleton of business names and handles; drop the SQL fold.",
  up: async (queryInterface, transaction) => {
    await executeSqlStatements(queryInterface, transaction, [`ALTER TABLE directory.entities ADD COLUMN name_skeleton text`]);
    await refold(
      queryInterface,
      transaction,
      { table: "directory.entities", key: "id", value: "name", column: "name_skeleton", cast: "uuid" },
      businessNameSkeleton,
    );
    await refold(
      queryInterface,
      transaction,
      { table: "directory.handles", key: "handle", value: "handle", column: "skeleton", cast: "text" },
      handleSkeleton,
    );
    await executeSqlStatements(queryInterface, transaction, upAfterBackfill);
  },
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

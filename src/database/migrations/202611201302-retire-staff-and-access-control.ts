import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * [current schema, current name, name in `retired`], children before parents
 * so the order reads as a dependency list; each move keeps its FKs anyway.
 */
const RETIRED = [
  ["access_control", "decisions", "access_control_decisions"],
  ["access_control", "device_events", "access_control_device_events"],
  ["access_control", "devices", "access_control_devices"],
  ["access_control", "credentials", "access_control_credentials"],
  ["membership", "staff_branch_scopes", "membership_staff_branch_scopes"],
  ["membership", "staff_profiles", "membership_staff_profiles"],
  ["admin", "user_permissions", "admin_user_permissions"],
  ["admin", "permissions", "admin_permissions"],
  ["admin", "retired_permission_grants", "admin_retired_permission_grants"],
] as const;

/**
 * Franja 7d (ADR-0029), reversible contraction: the gym staff machinery and
 * the physical access control leave the product. No route reads or writes
 * them any more (ADR-0026 removed their routes and the access worker; this
 * franja drops the last reader, the "training now" signal of Conocer, and the
 * permission catalog whose grants opened nothing since ADR-0019). The tables
 * move, data, indexes, constraints and FKs included, to the `retired` schema
 * (renamed with their old schema as prefix), as ADR-0026 did: the account
 * closure and the export keep erasing and returning what they hold until the
 * final DROP of a later franja. The empty `access_control` schema goes.
 *
 * Rollback: the schema comes back and every table returns to its schema and
 * name.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS retired`,
  ...RETIRED.flatMap(([schema, table, retired]) => [
    `ALTER TABLE ${schema}.${table} RENAME TO ${retired}`,
    `ALTER TABLE ${schema}.${retired} SET SCHEMA retired`,
  ]),
  `DROP SCHEMA IF EXISTS access_control RESTRICT`,
] as const;

const downStatements = [
  `CREATE SCHEMA IF NOT EXISTS access_control`,
  ...[...RETIRED].reverse().flatMap(([schema, table, retired]) => [
    `ALTER TABLE retired.${retired} SET SCHEMA ${schema}`,
    `ALTER TABLE ${schema}.${retired} RENAME TO ${table}`,
  ]),
] as const;

export const retireStaffAndAccessControlMigration: DatabaseMigration = {
  id: "202611201302-retire-staff-and-access-control",
  description:
    "Retire the gym staff tables, the physical access control and the admin permission catalog (ADR-0029): they move, data and all, to the `retired` schema. Reversible.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

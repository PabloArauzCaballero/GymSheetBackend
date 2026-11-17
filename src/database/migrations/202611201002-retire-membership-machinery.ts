import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/** [current schema, current name, name in `retired`]: the prefix keeps future retirements from colliding. */
const RETIRED = [
  ["membership", "plan_access_scopes", "membership_plan_access_scopes"],
  ["membership", "plan_features", "membership_plan_features"],
  ["membership", "features", "membership_features"],
  ["membership", "entitlements", "membership_entitlements"],
  ["membership", "extensions", "membership_extensions"],
  ["membership", "intents", "membership_intents"],
  ["membership", "customer_profiles", "membership_customer_profiles"],
  ["membership", "plans", "membership_plans"],
  ["public", "membership_activation_requests", "membership_activation_requests"],
] as const;

/**
 * Franja 8e-3 (ADR-0026), reversible contraction: the gym-operated membership
 * machinery leaves the product («las membresías pasan al marketplace»). Its
 * tables move, data and all, to the `retired` schema (renamed with their old
 * schema as prefix) and `memberships.plan_id` becomes `retired_plan_id`.
 * Indexes, constraints and foreign keys travel with each table, so the
 * account closure keeps erasing what they hold until the final DROP of a
 * later franja (30 days at least, plan §2.10).
 *
 * Rollback: every table goes back to its schema and name, and the column
 * gets its name back.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS retired`,
  ...RETIRED.flatMap(([schema, table, retired]) => [
    ...(retired === table ? [] : [`ALTER TABLE ${schema}.${table} RENAME TO ${retired}`]),
    `ALTER TABLE ${schema}.${retired} SET SCHEMA retired`,
  ]),
  `ALTER TABLE membership.memberships RENAME COLUMN plan_id TO retired_plan_id`,
] as const;

const downStatements = [
  `ALTER TABLE membership.memberships RENAME COLUMN retired_plan_id TO plan_id`,
  ...[...RETIRED].reverse().flatMap(([schema, table, retired]) => [
    `ALTER TABLE retired.${retired} SET SCHEMA ${schema}`,
    ...(retired === table ? [] : [`ALTER TABLE ${schema}.${retired} RENAME TO ${table}`]),
  ]),
  `DROP SCHEMA IF EXISTS retired RESTRICT`,
] as const;

export const retireMembershipMachineryMigration: DatabaseMigration = {
  id: "202611201002-retire-membership-machinery",
  description:
    "Retire the gym-operated membership machinery (ADR-0026): plans, features, entitlements, access scopes, intents, extensions, customer profiles and activation requests move to the `retired` schema; memberships.plan_id becomes retired_plan_id. Reversible.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

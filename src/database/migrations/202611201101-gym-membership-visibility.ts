import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 7c (ADR-0027): «Mi gimnasio», the gym ranking, the «Socio de X»
 * badge and the Conocer same-gym signal read the person's CONFIRMED SOCIO
 * affiliation (`directory.affiliations`), never `usuarios.tenant_id`.
 *
 * The only schema change is the person's privacy switch: whether other people
 * see that they are a member of their gym (badge, gym member list, gym
 * ranking, Conocer same-gym reason). On by default, as the owner decided
 * (16/11/2026: the confirmed affiliation gives the badge); the person turns
 * it off from «Mi gimnasio». Every read above is served by the affiliation
 * indexes of 202611200901 (`ux_affiliations_confirmed_socio`,
 * `ix_affiliations_gym_confirmed`); no index is added.
 *
 * No data is backfilled: tenant members of seeded gyms are not turned into
 * confirmed SOCIOs, because a confirmation is the gym's act (ADR-0027 §5).
 */
const upStatements = [
  `ALTER TABLE social.profile_settings ADD COLUMN gym_membership_visible boolean NOT NULL DEFAULT true`,
] as const;

const downStatements = [`ALTER TABLE social.profile_settings DROP COLUMN IF EXISTS gym_membership_visible`] as const;

export const gymMembershipVisibilityMigration: DatabaseMigration = {
  id: "202611201101-gym-membership-visibility",
  description:
    "Gym community by affiliation (ADR-0027): the person's switch to show or hide their confirmed gym membership (badge, member list, ranking, Conocer).",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

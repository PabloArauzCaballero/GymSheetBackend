import { PROFILE_GOAL_CHECK } from "./202611150003-profile-goal-sport-performance";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Validates the goal CHECK that `202611150003` added `NOT VALID`. It is a
 * separate migration so the existing rows are scanned in their own transaction,
 * under VALIDATE's SHARE UPDATE EXCLUSIVE lock, instead of under the ACCESS
 * EXCLUSIVE lock that ADD CONSTRAINT holds until its transaction commits.
 */
const upStatements = [
  `ALTER TABLE public.perfiles_antropometricos VALIDATE CONSTRAINT ${PROFILE_GOAL_CHECK}`,
] as const;

export const validateProfileGoalCheckMigration: DatabaseMigration = {
  id: "202611150004-validate-profile-goal-check",
  description: "Validates ck_perfiles_objetivo, added NOT VALID by 202611150003, without an exclusive scan.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  // A validated constraint cannot be marked NOT VALID again, and it does not need
  // to be: 202611150003's down drops and recreates it.
  down: () => Promise.resolve(),
};

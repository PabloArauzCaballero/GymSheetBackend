import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE training.training_invite_commands
     DROP CONSTRAINT ck_training_invite_command_state,
     ADD CONSTRAINT ck_training_invite_command_state
       CHECK (result_state IN ('ACCEPTED','PENDING','EXPIRED'))`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM training.training_invite_commands WHERE result_state = 'EXPIRED'
     ) THEN
       RAISE EXCEPTION 'Cannot roll back training invite expiration while expiration commands exist';
     END IF;
   END
   $$`,
  `ALTER TABLE training.training_invite_commands
     DROP CONSTRAINT ck_training_invite_command_state,
     ADD CONSTRAINT ck_training_invite_command_state
       CHECK (result_state IN ('ACCEPTED','PENDING'))`,
] as const;

export const trainingInviteExpirationMigration: DatabaseMigration = {
  id: "202610110006-training-invite-expiration",
  description:
    "Allows idempotent response commands to record invitations expired at their start time.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

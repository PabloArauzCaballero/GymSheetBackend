import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE training.training_invites
     DROP CONSTRAINT ck_training_invite_response_state,
     ADD CONSTRAINT ck_training_invite_response_state CHECK (
       (state IN ('ACCEPTED','DECLINED') AND responded_by_user_id IS NOT NULL
        AND responded_revision IS NOT NULL AND responded_at IS NOT NULL)
       OR (state = 'CANCELLED' AND (
         (responded_by_user_id IS NULL AND responded_revision IS NULL AND responded_at IS NULL)
         OR (responded_by_user_id IS NOT NULL AND responded_revision IS NOT NULL
             AND responded_at IS NOT NULL)
       ))
       OR (state NOT IN ('ACCEPTED','DECLINED','CANCELLED')
           AND responded_by_user_id IS NULL AND responded_revision IS NULL
           AND responded_at IS NULL)
     )`,
  `ALTER TABLE training.training_invite_commands
     DROP CONSTRAINT ck_training_invite_command_state,
     ADD CONSTRAINT ck_training_invite_command_state
       CHECK (result_state IN ('ACCEPTED','DECLINED','PENDING','EXPIRED'))`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM training.training_invites WHERE state = 'DECLINED')
        OR EXISTS (SELECT 1 FROM training.training_invite_commands WHERE result_state = 'DECLINED') THEN
       RAISE EXCEPTION 'Cannot roll back training invite decline while decline records exist';
     END IF;
   END
   $$`,
  `ALTER TABLE training.training_invite_commands
     DROP CONSTRAINT ck_training_invite_command_state,
     ADD CONSTRAINT ck_training_invite_command_state
       CHECK (result_state IN ('ACCEPTED','PENDING','EXPIRED'))`,
  `ALTER TABLE training.training_invites
     DROP CONSTRAINT ck_training_invite_response_state,
     ADD CONSTRAINT ck_training_invite_response_state CHECK (
       (state = 'ACCEPTED' AND responded_by_user_id IS NOT NULL
        AND responded_revision IS NOT NULL AND responded_at IS NOT NULL)
       OR (state = 'CANCELLED' AND (
         (responded_by_user_id IS NULL AND responded_revision IS NULL AND responded_at IS NULL)
         OR (responded_by_user_id IS NOT NULL AND responded_revision IS NOT NULL
             AND responded_at IS NOT NULL)
       ))
       OR (state NOT IN ('ACCEPTED','CANCELLED') AND responded_by_user_id IS NULL
           AND responded_revision IS NULL AND responded_at IS NULL)
     )`,
] as const;

export const trainingInviteDeclineMigration: DatabaseMigration = {
  id: "202610120001-training-invite-decline",
  description:
    "Allows participants to decline the current training invitation revision.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

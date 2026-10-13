import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE training.training_invites
     DROP CONSTRAINT ck_training_invite_response_recipient,
     ADD CONSTRAINT ck_training_invite_response_participant CHECK (
       responded_by_user_id IS NULL
       OR responded_by_user_id IN (inviter_id, recipient_id)
     )`,
  `ALTER TABLE training.training_invite_commands
     DROP CONSTRAINT ck_training_invite_command_type,
     ADD CONSTRAINT ck_training_invite_command_type
       CHECK (command_type IN ('RESPOND','COUNTERPROPOSE')),
     DROP CONSTRAINT ck_training_invite_command_state,
     ADD CONSTRAINT ck_training_invite_command_state
       CHECK (result_state IN ('ACCEPTED','PENDING'))`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (
          SELECT 1 FROM training.training_invite_commands
           WHERE command_type = 'COUNTERPROPOSE'
        ) OR EXISTS (
          SELECT 1 FROM training.training_invites
           WHERE responded_by_user_id = inviter_id
        ) THEN
       RAISE EXCEPTION 'Cannot roll back training invite counterproposals while their records exist';
     END IF;
   END
   $$`,
  `ALTER TABLE training.training_invite_commands
     DROP CONSTRAINT ck_training_invite_command_type,
     ADD CONSTRAINT ck_training_invite_command_type CHECK (command_type = 'RESPOND'),
     DROP CONSTRAINT ck_training_invite_command_state,
     ADD CONSTRAINT ck_training_invite_command_state CHECK (result_state = 'ACCEPTED')`,
  `ALTER TABLE training.training_invites
     DROP CONSTRAINT ck_training_invite_response_participant,
     ADD CONSTRAINT ck_training_invite_response_recipient CHECK (
       responded_by_user_id IS NULL OR responded_by_user_id = recipient_id
     )`,
] as const;

export const trainingInviteCounterproposalsMigration: DatabaseMigration = {
  id: "202610110004-training-invite-counterproposals",
  description:
    "Allows revision-bound, idempotent counterproposals from the other invite participant.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

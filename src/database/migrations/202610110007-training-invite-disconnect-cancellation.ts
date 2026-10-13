import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE training.training_invite_meetings
     ADD COLUMN cancelled_at timestamptz`,
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

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM training.training_invite_meetings WHERE cancelled_at IS NOT NULL
     ) OR EXISTS (
       SELECT 1 FROM training.training_invites
        WHERE state = 'CANCELLED' AND responded_by_user_id IS NOT NULL
     ) THEN
       RAISE EXCEPTION 'Cannot roll back disconnect cancellation while cancelled accepted meetings exist';
     END IF;
   END
   $$`,
  `ALTER TABLE training.training_invites
     DROP CONSTRAINT ck_training_invite_response_state,
     ADD CONSTRAINT ck_training_invite_response_state CHECK (
       (state = 'ACCEPTED' AND responded_by_user_id IS NOT NULL
        AND responded_revision IS NOT NULL AND responded_at IS NOT NULL)
       OR (state <> 'ACCEPTED' AND responded_by_user_id IS NULL
           AND responded_revision IS NULL AND responded_at IS NULL)
     )`,
  `ALTER TABLE training.training_invite_meetings DROP COLUMN cancelled_at`,
] as const;

export const trainingInviteDisconnectCancellationMigration: DatabaseMigration =
  {
    id: "202610110007-training-invite-disconnect-cancellation",
    description:
      "Records cancellation of future accepted training meetings when a connection is revoked.",
    up: (queryInterface, transaction) =>
      executeSqlStatements(queryInterface, transaction, upStatements),
    down: (queryInterface, transaction) =>
      executeSqlStatements(queryInterface, transaction, downStatements),
  };

import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE training.training_invite_revisions
     ADD COLUMN routine_snapshot jsonb`,
  `CREATE TABLE training.training_invite_shared_snapshots (
     invite_id uuid PRIMARY KEY REFERENCES training.training_invites(id) ON DELETE CASCADE,
     source_routine_id uuid NOT NULL REFERENCES training.routines(id) ON DELETE RESTRICT,
     accepted_revision integer NOT NULL CHECK (accepted_revision > 0),
     snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS training.training_invite_shared_snapshots`,
  `ALTER TABLE training.training_invite_revisions DROP COLUMN IF EXISTS routine_snapshot`,
] as const;

export const trainingInviteSharedSnapshotMigration: DatabaseMigration = {
  id: "202610110008-training-invite-shared-snapshot",
  description:
    "Immutable sanitized routine snapshot for accepted shared training invitations.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

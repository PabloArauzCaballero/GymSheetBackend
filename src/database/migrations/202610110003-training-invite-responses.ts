import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE training.training_invites
     ADD COLUMN responded_by_user_id uuid
       REFERENCES public.usuarios(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
     ADD COLUMN responded_revision integer,
     ADD COLUMN responded_at timestamptz,
     ADD CONSTRAINT ck_training_invite_response_fields CHECK (
       (responded_by_user_id IS NULL AND responded_revision IS NULL AND responded_at IS NULL)
       OR (responded_by_user_id IS NOT NULL AND responded_revision IS NOT NULL AND responded_at IS NOT NULL)
     ),
     ADD CONSTRAINT ck_training_invite_response_revision CHECK (
       responded_revision IS NULL OR responded_revision > 0
     ),
     ADD CONSTRAINT ck_training_invite_response_recipient CHECK (
       responded_by_user_id IS NULL OR responded_by_user_id = recipient_id
     ),
     ADD CONSTRAINT ck_training_invite_response_state CHECK (
       (state = 'ACCEPTED' AND responded_by_user_id IS NOT NULL
        AND responded_revision IS NOT NULL AND responded_at IS NOT NULL)
       OR (state <> 'ACCEPTED' AND responded_by_user_id IS NULL
        AND responded_revision IS NULL AND responded_at IS NULL)
     ),
     ADD CONSTRAINT ck_training_invite_response_current_revision CHECK (
       responded_revision IS NULL OR responded_revision = current_revision
     ),
     ADD CONSTRAINT fk_training_invite_response_revision
       FOREIGN KEY (id, responded_revision)
       REFERENCES training.training_invite_revisions (invite_id, revision)
       DEFERRABLE INITIALLY DEFERRED`,
  `CREATE TABLE training.training_invite_commands (
     invite_id uuid NOT NULL REFERENCES training.training_invites(id) ON DELETE CASCADE,
     actor_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     command_type varchar(16) NOT NULL DEFAULT 'RESPOND',
     client_request_id uuid NOT NULL,
     request_fingerprint char(64) NOT NULL,
     result_state varchar(12) NOT NULL,
     result_revision integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT pk_training_invite_commands PRIMARY KEY (actor_user_id, command_type, client_request_id),
     CONSTRAINT ck_training_invite_command_type CHECK (command_type IN ('RESPOND')),
     CONSTRAINT ck_training_invite_command_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
     CONSTRAINT ck_training_invite_command_state CHECK (result_state IN ('ACCEPTED')),
     CONSTRAINT ck_training_invite_command_revision CHECK (result_revision > 0)
   )`,
  `CREATE INDEX ix_training_invite_commands_invite ON training.training_invite_commands (invite_id, created_at)`,
  `CREATE FUNCTION training.guard_invite_revisions_append_only() RETURNS trigger
   LANGUAGE plpgsql
   AS $$
   BEGIN
     IF TG_OP = 'TRUNCATE' THEN
       RAISE EXCEPTION 'Training invite revisions cannot be truncated';
     END IF;
     IF TG_OP = 'UPDATE' THEN
       RAISE EXCEPTION 'Training invite revisions are append-only';
     END IF;
     IF TG_OP = 'DELETE' THEN
       IF pg_trigger_depth() > 1
          AND NOT EXISTS (
            SELECT 1 FROM training.training_invites WHERE id = OLD.invite_id
          ) THEN
         RETURN OLD;
       END IF;
       RAISE EXCEPTION 'Training invite revisions can only be removed by invite cascade cleanup';
     END IF;
     RETURN NULL;
   END
   $$`,
  `CREATE TRIGGER trg_training_invite_revisions_append_only
     BEFORE UPDATE OR DELETE ON training.training_invite_revisions
     FOR EACH ROW EXECUTE FUNCTION training.guard_invite_revisions_append_only()`,
  `CREATE TRIGGER trg_training_invite_revisions_no_truncate
     BEFORE TRUNCATE ON training.training_invite_revisions
     FOR EACH STATEMENT EXECUTE FUNCTION training.guard_invite_revisions_append_only()`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM training.training_invite_commands LIMIT 1)
        OR EXISTS (
          SELECT 1 FROM training.training_invites
           WHERE responded_by_user_id IS NOT NULL
        ) THEN
       RAISE EXCEPTION 'Cannot roll back training invite responses while response data exists';
     END IF;
   END
   $$`,
  `DROP TRIGGER IF EXISTS trg_training_invite_revisions_no_truncate ON training.training_invite_revisions`,
  `DROP TRIGGER IF EXISTS trg_training_invite_revisions_append_only ON training.training_invite_revisions`,
  `DROP FUNCTION IF EXISTS training.guard_invite_revisions_append_only()`,
  `DROP TABLE IF EXISTS training.training_invite_commands`,
  `ALTER TABLE training.training_invites
     DROP CONSTRAINT IF EXISTS ck_training_invite_response_recipient,
     DROP CONSTRAINT IF EXISTS fk_training_invite_response_revision,
     DROP CONSTRAINT IF EXISTS ck_training_invite_response_current_revision,
     DROP CONSTRAINT IF EXISTS ck_training_invite_response_state,
     DROP CONSTRAINT IF EXISTS ck_training_invite_response_revision,
     DROP CONSTRAINT IF EXISTS ck_training_invite_response_fields,
     DROP COLUMN IF EXISTS responded_at,
     DROP COLUMN IF EXISTS responded_revision,
     DROP COLUMN IF EXISTS responded_by_user_id`,
] as const;

export const trainingInviteResponsesMigration: DatabaseMigration = {
  id: "202610110003-training-invite-responses",
  description:
    "Persists idempotent invite responses and protects append-only revision history.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

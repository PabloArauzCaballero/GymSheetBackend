import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE training.training_invites (
     id uuid PRIMARY KEY,
     inviter_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     recipient_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     state varchar(12) NOT NULL DEFAULT 'PENDING',
     current_revision integer NOT NULL DEFAULT 1,
     client_request_id uuid NOT NULL,
     request_fingerprint char(64) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_training_invites_not_self CHECK (inviter_id <> recipient_id),
     CONSTRAINT ck_training_invites_state CHECK (state IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','CANCELLED')),
     CONSTRAINT ck_training_invites_revision CHECK (current_revision > 0),
     CONSTRAINT ck_training_invites_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
     CONSTRAINT uq_training_invites_request UNIQUE (inviter_id, client_request_id)
   )`,
  `CREATE UNIQUE INDEX uq_training_invites_pending_pair
     ON training.training_invites (LEAST(inviter_id, recipient_id), GREATEST(inviter_id, recipient_id))
     WHERE state = 'PENDING'`,
  `CREATE INDEX ix_training_invites_recipient_state
     ON training.training_invites (recipient_id, state, created_at DESC)`,
  `CREATE INDEX ix_training_invites_inviter_state
     ON training.training_invites (inviter_id, state, created_at DESC)`,
  `CREATE TABLE training.training_invite_revisions (
     invite_id uuid NOT NULL REFERENCES training.training_invites(id) ON DELETE CASCADE,
     revision integer NOT NULL,
     proposer_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     starts_at timestamptz NOT NULL,
     time_zone varchar(80) NOT NULL,
     duration_minutes integer NOT NULL DEFAULT 60,
     place_kind varchar(16) NOT NULL,
     place_id uuid,
     place_label varchar(180) NOT NULL,
     mode varchar(20) NOT NULL DEFAULT 'OWN_ROUTINES',
     routine_session_id uuid,
     note text,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (invite_id, revision),
     CONSTRAINT ck_training_invite_revision_positive CHECK (revision > 0),
     CONSTRAINT ck_training_invite_duration CHECK (duration_minutes BETWEEN 15 AND 360),
     CONSTRAINT ck_training_invite_place_kind CHECK (place_kind IN ('GYM','PUBLIC_PLACE')),
     CONSTRAINT ck_training_invite_gym_place CHECK (place_kind <> 'GYM' OR place_id IS NOT NULL),
     CONSTRAINT ck_training_invite_mode CHECK (mode IN ('OWN_ROUTINES','SHARED_SESSION')),
     CONSTRAINT ck_training_invite_shared_routine CHECK (mode <> 'SHARED_SESSION' OR routine_session_id IS NOT NULL)
   )`,
  `CREATE INDEX ix_training_invite_revisions_start
     ON training.training_invite_revisions (starts_at)`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM training.training_invites LIMIT 1)
        OR EXISTS (SELECT 1 FROM training.training_invite_revisions LIMIT 1) THEN
       RAISE EXCEPTION 'Cannot roll back training invitations while invitation records exist';
     END IF;
   END
   $$`,
  `DROP TABLE IF EXISTS training.training_invite_revisions`,
  `DROP TABLE IF EXISTS training.training_invites`,
] as const;

export const trainingInvitationsMigration: DatabaseMigration = {
  id: "202610110002-training-invitations",
  description:
    "Persists training invitations and append-only proposal revisions.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

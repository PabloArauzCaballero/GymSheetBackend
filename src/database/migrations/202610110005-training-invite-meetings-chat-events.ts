import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE training.training_invite_meetings (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     invite_id uuid NOT NULL UNIQUE REFERENCES training.training_invites(id) ON DELETE CASCADE,
     accepted_revision integer NOT NULL,
     starts_at timestamptz NOT NULL,
     time_zone varchar(80) NOT NULL,
     place_label varchar(180) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_training_invite_meeting_revision CHECK (accepted_revision > 0),
     CONSTRAINT uq_training_invite_meeting_revision UNIQUE (invite_id, accepted_revision),
     CONSTRAINT fk_training_invite_meeting_revision
       FOREIGN KEY (invite_id, accepted_revision)
       REFERENCES training.training_invite_revisions(invite_id, revision)
       DEFERRABLE INITIALLY DEFERRED
   )`,
  `CREATE TABLE chat.conversation_events (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     conversation_id uuid NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
     invitation_id uuid NOT NULL UNIQUE REFERENCES training.training_invites(id) ON DELETE CASCADE,
     accepted_revision integer NOT NULL,
     starts_at timestamptz NOT NULL,
     time_zone varchar(80) NOT NULL,
     place_label varchar(180) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_chat_conversation_event_revision CHECK (accepted_revision > 0),
     CONSTRAINT fk_chat_conversation_event_meeting
       FOREIGN KEY (invitation_id, accepted_revision)
       REFERENCES training.training_invite_meetings(invite_id, accepted_revision)
       DEFERRABLE INITIALLY DEFERRED
   )`,
  `CREATE INDEX ix_chat_conversation_events_history
     ON chat.conversation_events (conversation_id, created_at DESC, id DESC)`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM chat.conversation_events LIMIT 1)
        OR EXISTS (SELECT 1 FROM training.training_invite_meetings LIMIT 1) THEN
       RAISE EXCEPTION 'Cannot roll back training invite meetings while accepted meetings exist';
     END IF;
   END
   $$`,
  `DROP TABLE IF EXISTS chat.conversation_events`,
  `DROP TABLE IF EXISTS training.training_invite_meetings`,
] as const;

export const trainingInviteMeetingsChatEventsMigration: DatabaseMigration = {
  id: "202610110005-training-invite-meetings-chat-events",
  description:
    "Persists accepted training meetings and their visible chat history events atomically.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

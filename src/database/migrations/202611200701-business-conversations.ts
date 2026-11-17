import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 8f (ADR-0023): chat between a person and a business.
 *
 * 1. `chat.conversations.kind` (DIRECT | SYSTEM | BUSINESS, default DIRECT);
 *    existing rows with a `system_kind` become SYSTEM. `system_kind` keeps
 *    saying which system chat it is.
 * 2. A BUSINESS conversation names its listing (`business_entity_id`) and its
 *    person (`person_user_id`); a partial unique index keeps one live
 *    conversation per pair, which is what makes the open idempotent.
 * 3. No disappearing messages in a BUSINESS conversation (dispute evidence):
 *    a CHECK, not only the service.
 * 4. `chat.business_blocks`: a business blocked this person. The conversation
 *    is revoked and the person cannot open a new one.
 *
 * Rollback: BUSINESS conversations are revoked (soft, no message is deleted)
 * so the previous code never lists them as plain 1:1 chats, then the table,
 * index, CHECKs and columns go away.
 */
const upStatements = [
  `ALTER TABLE chat.conversations
     ADD COLUMN kind varchar(10) NOT NULL DEFAULT 'DIRECT',
     ADD COLUMN business_entity_id uuid REFERENCES directory.entities(id) ON DELETE RESTRICT,
     ADD COLUMN person_user_id uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT`,
  `UPDATE chat.conversations SET kind = 'SYSTEM' WHERE system_kind IS NOT NULL`,
  `ALTER TABLE chat.conversations
     ADD CONSTRAINT ck_chat_conversations_kind CHECK (kind IN ('DIRECT', 'SYSTEM', 'BUSINESS')),
     ADD CONSTRAINT ck_chat_conversations_system_kind_of_kind CHECK (kind <> 'SYSTEM' OR system_kind IS NOT NULL),
     ADD CONSTRAINT ck_chat_conversations_business_parties CHECK (
       (kind = 'BUSINESS') = (business_entity_id IS NOT NULL)
       AND (kind = 'BUSINESS') = (person_user_id IS NOT NULL)
       AND (kind <> 'BUSINESS' OR system_kind IS NULL)),
     ADD CONSTRAINT ck_chat_conversations_business_not_disappearing CHECK (
       kind <> 'BUSINESS' OR disappearing_seconds IS NULL)`,
  `CREATE UNIQUE INDEX ux_chat_conversations_business_live
     ON chat.conversations (business_entity_id, person_user_id)
     WHERE kind = 'BUSINESS' AND revoked_at IS NULL`,
  // The daily limit counts a person's openings in the last 24 h.
  `CREATE INDEX ix_chat_conversations_business_person
     ON chat.conversations (person_user_id, created_at DESC)
     WHERE kind = 'BUSINESS'`,
  `CREATE TABLE chat.business_blocks (
     business_entity_id uuid NOT NULL REFERENCES directory.entities(id) ON DELETE CASCADE,
     person_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     blocked_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     conversation_id uuid REFERENCES chat.conversations(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (business_entity_id, person_user_id)
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS chat.business_blocks`,
  `UPDATE chat.conversations SET revoked_at = now() WHERE kind = 'BUSINESS' AND revoked_at IS NULL`,
  `DROP INDEX IF EXISTS chat.ix_chat_conversations_business_person`,
  `DROP INDEX IF EXISTS chat.ux_chat_conversations_business_live`,
  `ALTER TABLE chat.conversations
     DROP CONSTRAINT IF EXISTS ck_chat_conversations_business_not_disappearing,
     DROP CONSTRAINT IF EXISTS ck_chat_conversations_business_parties,
     DROP CONSTRAINT IF EXISTS ck_chat_conversations_system_kind_of_kind,
     DROP CONSTRAINT IF EXISTS ck_chat_conversations_kind`,
  `ALTER TABLE chat.conversations
     DROP COLUMN IF EXISTS person_user_id,
     DROP COLUMN IF EXISTS business_entity_id,
     DROP COLUMN IF EXISTS kind`,
] as const;

export const businessConversationsMigration: DatabaseMigration = {
  id: "202611200701-business-conversations",
  description:
    "Chat with businesses: chat.conversations.kind (DIRECT|SYSTEM|BUSINESS), the listing and person of a BUSINESS conversation, one live conversation per pair, no disappearing messages there, and the businesses' blocks.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

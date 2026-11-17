import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const KIND = `system_kind = 'TENANT_ADMIN'`;
const CONVERSATIONS = "retired.chat_tenant_admin_conversations";
const MESSAGES = "retired.chat_tenant_admin_messages";
const IN_COPIED = `conversation_id IN (SELECT id FROM ${CONVERSATIONS})`;
const OF_COPIED_MESSAGE = `message_id IN (SELECT id FROM ${MESSAGES})`;
const TO_CONVERSATION = `FOREIGN KEY (conversation_id) REFERENCES ${CONVERSATIONS} (id) ON DELETE CASCADE`;
const TO_MESSAGE = `FOREIGN KEY (message_id) REFERENCES ${MESSAGES} (id) ON DELETE CASCADE`;
const LEDGER_FK = "tenant_admin_chat_revocations_conversation_id_fkey";

/** [chat table, copy in `retired`, extra constraints of the copy, rows to copy], parents first. */
const COPIES = [
  ["conversations", CONVERSATIONS, "PRIMARY KEY (id)", KIND],
  ["participants", "retired.chat_tenant_admin_participants", TO_CONVERSATION, IN_COPIED],
  ["messages", MESSAGES, `PRIMARY KEY (id), ${TO_CONVERSATION}`, IN_COPIED],
  ["message_visibility", "retired.chat_tenant_admin_message_visibility", TO_MESSAGE, OF_COPIED_MESSAGE],
  ["message_reactions", "retired.chat_tenant_admin_message_reactions", TO_MESSAGE, OF_COPIED_MESSAGE],
  ["conversation_events", "retired.chat_tenant_admin_conversation_events", TO_CONVERSATION, IN_COPIED],
  ["conversation_timer_events", "retired.chat_tenant_admin_conversation_timer_events", TO_CONVERSATION, IN_COPIED],
] as const;

/**
 * Franja 7d (ADR-0029), reversible contraction of the gym admin system chat
 * (`TENANT_ADMIN`), revoked and hidden since franja 7a (ADR-0019, migration
 * 202611200301). Its rows, with every child row, are copied to `retired`
 * (cascading among themselves, so the account closure erases a copied chat
 * with one delete) and removed from `chat`; 7a's revocation ledger moves with
 * them. Then the `system_kind` CHECK admits only `CORPORATE`.
 *
 * Rollback: the CHECK is widened again and every copied row goes back, with
 * the ledger, so 202611200301's own rollback can re-open exactly its chats.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS retired`,
  ...COPIES.flatMap(([table, copy, constraints, rows]) => [
    `CREATE TABLE IF NOT EXISTS ${copy} (LIKE chat.${table} INCLUDING DEFAULTS, ${constraints})`,
    `INSERT INTO ${copy} SELECT * FROM chat.${table} WHERE ${rows}`,
  ]),
  `ALTER TABLE chat.tenant_admin_chat_revocations DROP CONSTRAINT IF EXISTS ${LEDGER_FK}`,
  `ALTER TABLE chat.tenant_admin_chat_revocations RENAME TO chat_tenant_admin_chat_revocations`,
  `ALTER TABLE chat.chat_tenant_admin_chat_revocations SET SCHEMA retired`,
  `ALTER TABLE retired.chat_tenant_admin_chat_revocations ADD CONSTRAINT ${LEDGER_FK} ${TO_CONVERSATION}`,
  `DELETE FROM chat.conversations WHERE ${KIND}`,
  `ALTER TABLE chat.conversations DROP CONSTRAINT IF EXISTS ck_chat_conversations_system_kind`,
  `ALTER TABLE chat.conversations
     ADD CONSTRAINT ck_chat_conversations_system_kind CHECK (system_kind IN ('CORPORATE'))`,
] as const;

const downStatements = [
  `ALTER TABLE chat.conversations DROP CONSTRAINT IF EXISTS ck_chat_conversations_system_kind`,
  `ALTER TABLE chat.conversations
     ADD CONSTRAINT ck_chat_conversations_system_kind CHECK (system_kind IN ('CORPORATE', 'TENANT_ADMIN'))`,
  ...COPIES.map(([table, copy]) => `INSERT INTO chat.${table} SELECT * FROM ${copy}`),
  `ALTER TABLE retired.chat_tenant_admin_chat_revocations DROP CONSTRAINT IF EXISTS ${LEDGER_FK}`,
  `ALTER TABLE retired.chat_tenant_admin_chat_revocations SET SCHEMA chat`,
  `ALTER TABLE chat.chat_tenant_admin_chat_revocations RENAME TO tenant_admin_chat_revocations`,
  `ALTER TABLE chat.tenant_admin_chat_revocations
     ADD CONSTRAINT ${LEDGER_FK} FOREIGN KEY (conversation_id) REFERENCES chat.conversations (id) ON DELETE CASCADE`,
  ...[...COPIES].reverse().map(([, copy]) => `DROP TABLE IF EXISTS ${copy}`),
] as const;

export const retireTenantAdminChatsMigration: DatabaseMigration = {
  id: "202611201303-retire-tenant-admin-chats",
  description:
    "Moves the legacy TENANT_ADMIN system chats (with their messages and 7a's revocation ledger) to the `retired` schema and narrows the system_kind CHECK to CORPORATE (ADR-0029). Reversible.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

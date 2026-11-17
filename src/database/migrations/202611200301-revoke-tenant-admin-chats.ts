import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 7a (ADR-0019): the gym no longer has staff, so the pinned
 * "gym admin" system chat (`system_kind = 'TENANT_ADMIN'`) stops existing for
 * members. The code no longer creates or lists it; this migration revokes the
 * conversations that already exist, the same soft revocation every other chat
 * uses (`revoked_at`), so no message is deleted.
 *
 * The ledger records exactly which conversations this migration revoked, and
 * with which timestamp, so the rollback re-opens those and only those: a
 * conversation revoked for another reason stays revoked. The
 * `ck_chat_conversations_system_kind` CHECK is left untouched until franja 7d
 * (contraction), which also removes the legacy rows and this ledger.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS chat.tenant_admin_chat_revocations (
     conversation_id uuid PRIMARY KEY REFERENCES chat.conversations (id) ON DELETE CASCADE,
     revoked_at timestamptz NOT NULL
   )`,
  `INSERT INTO chat.tenant_admin_chat_revocations (conversation_id, revoked_at)
   SELECT c.id, now()
     FROM chat.conversations c
    WHERE c.system_kind = 'TENANT_ADMIN' AND c.revoked_at IS NULL
   ON CONFLICT (conversation_id) DO NOTHING`,
  `UPDATE chat.conversations c
      SET revoked_at = r.revoked_at
     FROM chat.tenant_admin_chat_revocations r
    WHERE r.conversation_id = c.id AND c.revoked_at IS NULL`,
] as const;

const downStatements = [
  `UPDATE chat.conversations c
      SET revoked_at = NULL
     FROM chat.tenant_admin_chat_revocations r
    WHERE r.conversation_id = c.id AND c.revoked_at = r.revoked_at`,
  `DROP TABLE IF EXISTS chat.tenant_admin_chat_revocations`,
] as const;

export const revokeTenantAdminChatsMigration: DatabaseMigration = {
  id: "202611200301-revoke-tenant-admin-chats",
  description:
    "Revokes the legacy TENANT_ADMIN system conversations (franja 7a) and records them so the rollback re-opens exactly those.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

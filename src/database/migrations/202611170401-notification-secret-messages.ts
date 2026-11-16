import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * `notifications.messages.secret`: messages that carry a credential (a PIN that
 * proves a mailbox or authorizes a sensitive step). They are delivered by
 * email only, never listed in the in-app inbox, and their body is redacted as
 * soon as the delivery succeeds. Without this, anyone holding the session
 * could read the PIN in the app and skip the mailbox proof.
 *
 * Existing PIN messages are marked by their deduplication key prefixes and
 * redacted if already sent.
 */
const upStatements = [
  `ALTER TABLE notifications.messages ADD COLUMN IF NOT EXISTS secret boolean NOT NULL DEFAULT false`,
  `UPDATE notifications.messages SET secret = true
    WHERE deduplication_key LIKE 'email-verification-%' OR deduplication_key LIKE 'password-reset-%'`,
  `UPDATE notifications.messages SET body = '[Código enviado por correo]'
    WHERE secret = true AND status IN ('SENT', 'READ')`,
] as const;

const downStatements = [`ALTER TABLE notifications.messages DROP COLUMN IF EXISTS secret`] as const;

export const notificationSecretMessagesMigration: DatabaseMigration = {
  id: "202611170401-notification-secret-messages",
  description: "Marks credential-carrying messages as secret: never listed in-app and redacted after delivery.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

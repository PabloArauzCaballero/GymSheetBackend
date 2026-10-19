import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE notifications.messages
     DROP CONSTRAINT ck_notification_status`,
  `ALTER TABLE notifications.messages
     ADD CONSTRAINT ck_notification_status
     CHECK (status IN ('PENDING','SENT','FAILED','DEAD_LETTER','READ','SUPPRESSED'))`,
] as const;

const downStatements = [
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM notifications.messages WHERE status = 'SUPPRESSED') THEN
       RAISE EXCEPTION 'Cannot roll back notification suppression while suppressed messages exist';
     END IF;
   END
   $$`,
  `ALTER TABLE notifications.messages
     DROP CONSTRAINT ck_notification_status`,
  `ALTER TABLE notifications.messages
     ADD CONSTRAINT ck_notification_status
     CHECK (status IN ('PENDING','SENT','FAILED','DEAD_LETTER','READ'))`,
] as const;

export const notificationSuppressionMigration: DatabaseMigration = {
  id: "202610130003-notification-suppression",
  description:
    "Tracks queued social notices suppressed after their connection is revoked.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

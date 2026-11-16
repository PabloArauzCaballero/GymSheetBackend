import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

// Product decision (2026-11-16): chat pushes show the message text by default,
// like WhatsApp; each user can turn it off in Settings. It applies to existing
// users too: until now no client exposed the switch, so nobody chose "off".
const upStatements = [
  `ALTER TABLE notifications.preferences
     ALTER COLUMN message_preview_enabled SET DEFAULT true`,
  `UPDATE notifications.preferences SET message_preview_enabled = true
    WHERE message_preview_enabled = false`,
] as const;

// Only the default goes back: which rows were "off" before is not recorded.
const downStatements = [
  `ALTER TABLE notifications.preferences
     ALTER COLUMN message_preview_enabled SET DEFAULT false`,
] as const;

export const messagePreviewsOnByDefaultMigration: DatabaseMigration = {
  id: '202611160001-message-previews-on-by-default',
  description: 'Shows chat message text in push notifications by default.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

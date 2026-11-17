import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

// Product decision (2026-11-16): chat pushes show the message text by default,
// like WhatsApp; each user can turn it off in Settings. Only the column default
// changes, so it applies to new preference rows. Existing rows keep their stored
// value: flipping them would override a privacy setting without the user's
// consent, and it could not be undone because the previous values are not kept.
const upStatements = [
  `ALTER TABLE notifications.preferences
     ALTER COLUMN message_preview_enabled SET DEFAULT true`,
] as const;

const downStatements = [
  `ALTER TABLE notifications.preferences
     ALTER COLUMN message_preview_enabled SET DEFAULT false`,
] as const;

export const messagePreviewsOnByDefaultMigration: DatabaseMigration = {
  id: '202611160001-message-previews-on-by-default',
  description: 'Shows chat message text in push notifications by default for new users.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

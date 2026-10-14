import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `ALTER TABLE notifications.preferences
     ADD COLUMN message_preview_enabled boolean NOT NULL DEFAULT false`,
] as const;

const downStatements = [
  `ALTER TABLE notifications.preferences
     DROP COLUMN message_preview_enabled`,
] as const;

export const privateMessagePreviewsMigration: DatabaseMigration = {
  id: '202610130004-private-message-previews',
  description: 'Adds an opt-in preference for private message text in push previews.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE TABLE notifications.preferences (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL UNIQUE REFERENCES public.usuarios(id) ON DELETE CASCADE,
     membership_expiry_enabled boolean NOT NULL DEFAULT true,
     preferred_channel varchar(30) NOT NULL DEFAULT 'IN_APP',
     external_delivery_consent_at timestamptz,
     consent_version varchar(80),
     quiet_hours_start time,
     quiet_hours_end time,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_notification_preferred_channel CHECK (
       preferred_channel IN ('IN_APP','HTTP_GATEWAY')
     ),
     CONSTRAINT ck_notification_external_consent CHECK (
       preferred_channel <> 'HTTP_GATEWAY'
       OR (external_delivery_consent_at IS NOT NULL AND consent_version IS NOT NULL)
     ),
     CONSTRAINT ck_notification_quiet_hours CHECK (
       (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
       OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
     )
   )`,
  `CREATE INDEX ix_notification_preferences_enabled
     ON notifications.preferences(membership_expiry_enabled, preferred_channel)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS notifications.preferences`,
] as const;

export const notificationPreferencesMigration: DatabaseMigration = {
  id: '202607190005-notification-preferences',
  description: 'Adds consent-aware notification preferences for membership reminders.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

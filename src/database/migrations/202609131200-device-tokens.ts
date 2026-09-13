import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE TABLE notifications.device_tokens (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     platform varchar(20) NOT NULL,
     expo_push_token varchar(200) NOT NULL UNIQUE,
     active boolean NOT NULL DEFAULT true,
     last_seen_at timestamptz NOT NULL DEFAULT now(),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_device_tokens_platform CHECK (platform IN ('ANDROID','IOS'))
   )`,
  // Un mismo token puede volver a registrarse (reinstalación, refresco de Expo) desde otro
  // usuario si el dispositivo cambió de cuenta; el UNIQUE de arriba ya lo fuerza a existir una
  // sola vez, así que el registro reasigna el dueño en vez de duplicar.
  `CREATE INDEX ix_device_tokens_user_active
     ON notifications.device_tokens(user_id, active)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS notifications.device_tokens`] as const;

export const deviceTokensMigration: DatabaseMigration = {
  id: '202609131200-device-tokens',
  description: 'Adds device_tokens for real push notifications (Expo Push API / FCM).',
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

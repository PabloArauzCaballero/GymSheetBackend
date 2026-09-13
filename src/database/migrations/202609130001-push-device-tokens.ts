import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE TABLE notifications.device_tokens (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     expo_push_token varchar(200) NOT NULL UNIQUE,
     platform varchar(20) NOT NULL,
     revoked_at timestamptz,
     last_registered_at timestamptz NOT NULL DEFAULT now(),
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_device_token_platform CHECK (platform IN ('ANDROID','IOS'))
   )`,
  // El token es único en toda la tabla, no por usuario: un teléfono prestado no
  // puede quedar registrado a dos cuentas a la vez o recibiría los avisos de
  // ambas. Registrar un token que ya existía lo traslada a la cuenta nueva.
  `CREATE INDEX ix_device_tokens_active_recipient
     ON notifications.device_tokens(user_id)
     WHERE revoked_at IS NULL`,
  // El canal es una lista cerrada en la tabla de mensajes y PostgreSQL no deja
  // ampliar un CHECK: hay que reemplazarlo entero. Sin esto, encolar un aviso
  // por PUSH revienta en la escritura, no al enviarlo.
  `ALTER TABLE notifications.messages
     DROP CONSTRAINT IF EXISTS ck_notification_channel`,
  `ALTER TABLE notifications.messages
     ADD CONSTRAINT ck_notification_channel
     CHECK (channel IN ('IN_APP','EMAIL','HTTP_GATEWAY','PUSH','MOCK'))`,
] as const;

const downStatements = [
  // `NOT VALID`, igual que cuando se añadió EMAIL: la restricción vieja no
  // acepta 'PUSH' y validarla exigiría borrar los avisos ya enviados. El
  // historial de mensajería es append-only; revertir el esquema no es motivo
  // para perder el registro de lo que se entregó.
  `ALTER TABLE notifications.messages
     DROP CONSTRAINT IF EXISTS ck_notification_channel`,
  `ALTER TABLE notifications.messages
     ADD CONSTRAINT ck_notification_channel
     CHECK (channel IN ('IN_APP','EMAIL','HTTP_GATEWAY','MOCK')) NOT VALID`,
  `DROP TABLE IF EXISTS notifications.device_tokens`,
] as const;

export const pushDeviceTokensMigration: DatabaseMigration = {
  id: '202609130001-push-device-tokens',
  description:
    'Expo push tokens per device and PUSH as a delivery channel for the messaging port.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

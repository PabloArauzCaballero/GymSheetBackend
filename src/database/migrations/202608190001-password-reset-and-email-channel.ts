import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Recuperación de contraseña por PIN, y el correo como canal de mensajería.
 *
 * Hasta ahora la única forma de volver a entrar era que alguien de recepción
 * cambiara la contraseña a mano, lo que convierte un olvido —el fallo de
 * autenticación más común que existe— en una visita al gimnasio.
 *
 * El PIN se guarda **hasheado**, igual que una contraseña. Un código de seis
 * cifras con vida corta sigue siendo una credencial: quien lea la tabla, por
 * una copia de seguridad extraviada o por una inyección, no debe poder entrar
 * en ninguna cuenta. Y por eso mismo se cuentan los intentos: seis cifras son
 * un millón de combinaciones, que un script prueba en minutos si se le deja.
 *
 * `consumido_en` en vez de borrar la fila: un token gastado es un hecho que
 * interesa —dice que alguien completó el cambio y cuándo—, y borrarlo dejaría
 * el rastro de una recuperación exitosa indistinguible del de una que nunca
 * ocurrió.
 *
 * El índice parcial sobre los vigentes es el que resuelve la consulta caliente
 * («¿tiene esta persona un PIN sin usar?») sin arrastrar el histórico.
 */
const upStatements = [
  `CREATE TABLE password_reset_tokens (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
     pin_hash text NOT NULL,
     expira_en timestamptz NOT NULL,
     consumido_en timestamptz,
     intentos integer NOT NULL DEFAULT 0,
     solicitado_desde_ip inet,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_password_reset_intentos CHECK (intentos >= 0),
     CONSTRAINT ck_password_reset_consumo CHECK (consumido_en IS NULL OR consumido_en >= created_at)
   )`,
  `CREATE INDEX ix_password_reset_vigentes
     ON password_reset_tokens (usuario_id, expira_en)
     WHERE consumido_en IS NULL`,
  // El canal existía como texto con lista cerrada. Añadir EMAIL exige
  // reemplazar la restricción entera: PostgreSQL no permite ampliar un CHECK.
  `ALTER TABLE notifications.messages
     DROP CONSTRAINT IF EXISTS ck_notification_channel`,
  `ALTER TABLE notifications.messages
     ADD CONSTRAINT ck_notification_channel
     CHECK (channel IN ('IN_APP','EMAIL','HTTP_GATEWAY','MOCK'))`,
] as const;

const downStatements = [
  `ALTER TABLE notifications.messages
     DROP CONSTRAINT IF EXISTS ck_notification_channel`,
  // `NOT VALID` es la parte importante de esta reversión. La restricción vieja
  // no acepta 'EMAIL', y validarla contra la tabla exigiría borrar los correos
  // ya enviados: el historial de mensajería es append-only, y una reversión de
  // esquema no es motivo para perder el registro de lo que se entregó. Así la
  // restricción vuelve a gobernar las escrituras nuevas y las filas existentes
  // quedan intactas.
  `ALTER TABLE notifications.messages
     ADD CONSTRAINT ck_notification_channel
     CHECK (channel IN ('IN_APP','HTTP_GATEWAY','MOCK')) NOT VALID`,
  `DROP INDEX IF EXISTS ix_password_reset_vigentes`,
  `DROP TABLE IF EXISTS password_reset_tokens`,
] as const;

export const passwordResetAndEmailChannelMigration: DatabaseMigration = {
  id: "202608190001-password-reset-and-email-channel",
  description:
    "Password reset PINs (hashed, expiring, attempt-counted) and EMAIL as a delivery channel for the messaging port.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

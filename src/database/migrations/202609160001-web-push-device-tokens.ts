import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Web Push (VAPID) junto a Expo en la MISMA tabla de dispositivos.
 *
 * ## Por qué una sola tabla
 *
 * Una fila de `device_tokens` responde siempre a la misma pregunta: «¿por dónde
 * se alcanza este dispositivo de este usuario?». Que el navegador y el teléfono
 * se alcancen por caminos distintos es un detalle del transporte, no una entidad
 * distinta. Separarlos en dos tablas habría duplicado `user_id`, `active`,
 * `last_seen_at` y, sobre todo, el fan-out: el worker tendría que preguntar dos
 * veces y unir en memoria. Un usuario con el móvil y el navegador a la vez es el
 * caso normal, no la excepción.
 *
 * ## `expo_push_token` -> `push_token`
 *
 * La columna ya guardaba «la cadena opaca que el transporte necesita para llegar
 * a este dispositivo»; lo único específico de Expo era el nombre. Ahora guarda
 * un `ExponentPushToken[...]` cuando la plataforma es ANDROID/IOS y la URL del
 * `endpoint` de la suscripción cuando es WEB. Con eso el UNIQUE sigue siendo uno
 * solo y sigue significando lo mismo —un destino, una fila—, en vez de repartir
 * la identidad entre dos columnas nulables donde sería posible una fila con las
 * dos vacías o las dos llenas.
 *
 * El contrato HTTP del móvil NO cambia: el cuerpo sigue llevando
 * `expoPushToken`. Es el nombre de la columna lo que deja de mentir, no la API.
 *
 * Se amplía a 500 caracteres porque un endpoint de FCM o de Mozilla es mucho más
 * largo que un token de Expo. Ensanchar un `varchar` no reescribe la tabla.
 *
 * ## Lo que NO comparte forma: las claves de cifrado
 *
 * Un token de Expo es un destino y nada más: Expo cifra por su cuenta. Web Push
 * (RFC 8291) exige además cifrar el cuerpo con dos claves que sólo el navegador
 * conoce —`p256dh` (clave pública del cliente, P-256) y `auth` (secreto de
 * autenticación de 16 bytes)—. Van en columnas propias y no en un `jsonb`
 * genérico porque son obligatorias y de forma fija para WEB: un CHECK puede
 * exigirlas, y una clave suelta dentro de un JSON no la exige nadie.
 *
 * El CHECK es simétrico a propósito: WEB obliga a tenerlas, y ANDROID/IOS obliga
 * a NO tenerlas. Así la tabla no puede llegar a un estado donde el worker tenga
 * que adivinar por qué camino sale una fila.
 */
const upStatements = [
  // El UNIQUE viaja con la columna y conserva su nombre autogenerado
  // (`device_tokens_expo_push_token_key`). No se renombra a propósito: el nombre
  // no lo referencia nadie, y adivinarlo en un `ALTER ... RENAME CONSTRAINT`
  // rompería la migración en cualquier entorno donde Postgres lo hubiera
  // resuelto distinto.
  `ALTER TABLE notifications.device_tokens
     RENAME COLUMN expo_push_token TO push_token`,
  `ALTER TABLE notifications.device_tokens
     ALTER COLUMN push_token TYPE varchar(500)`,
  `ALTER TABLE notifications.device_tokens
     ADD COLUMN p256dh varchar(200),
     ADD COLUMN auth varchar(100)`,
  // El CHECK de plataforma se sustituye entero: sumar 'WEB' a una lista cerrada
  // no se puede hacer en sitio.
  `ALTER TABLE notifications.device_tokens
     DROP CONSTRAINT IF EXISTS ck_device_tokens_platform`,
  `ALTER TABLE notifications.device_tokens
     ADD CONSTRAINT ck_device_tokens_platform
     CHECK (platform IN ('ANDROID','IOS','WEB'))`,
  `ALTER TABLE notifications.device_tokens
     ADD CONSTRAINT ck_device_tokens_web_keys
     CHECK (
       (platform = 'WEB' AND p256dh IS NOT NULL AND auth IS NOT NULL)
       OR (platform <> 'WEB' AND p256dh IS NULL AND auth IS NULL)
     )`,
] as const;

/**
 * La vuelta atrás borra las suscripciones de navegador: antes de esta migración
 * no podían existir, y la columna que las identifica deja de caber. Es la
 * inversa exacta del `up`, no una pérdida de datos preexistentes.
 */
const downStatements = [
  `DELETE FROM notifications.device_tokens WHERE platform = 'WEB'`,
  `ALTER TABLE notifications.device_tokens
     DROP CONSTRAINT IF EXISTS ck_device_tokens_web_keys`,
  `ALTER TABLE notifications.device_tokens
     DROP CONSTRAINT IF EXISTS ck_device_tokens_platform`,
  `ALTER TABLE notifications.device_tokens
     ADD CONSTRAINT ck_device_tokens_platform
     CHECK (platform IN ('ANDROID','IOS'))`,
  `ALTER TABLE notifications.device_tokens
     DROP COLUMN IF EXISTS p256dh,
     DROP COLUMN IF EXISTS auth`,
  `ALTER TABLE notifications.device_tokens
     ALTER COLUMN push_token TYPE varchar(200)`,
  `ALTER TABLE notifications.device_tokens
     RENAME COLUMN push_token TO expo_push_token`,
] as const;

export const webPushDeviceTokensMigration: DatabaseMigration = {
  id: "202609160001-web-push-device-tokens",
  description:
    "Generalises device_tokens to hold browser Web Push subscriptions (platform WEB, p256dh/auth keys) alongside Expo tokens.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Permite que `training.exercise_media.url` apunte a media auto-alojada servida
 * por **http en cualquier host**, no solo en loopback.
 *
 * Por qué: el almacén propio (MinIO) de los entornos que no tienen certificado
 * se publica por http plano —p. ej. `http://gym-media.<ip>.sslip.io/...`—. Con
 * la restricción anterior la carga guardaba el objeto y luego fallaba al
 * insertar la fila, dejando un binario huérfano en un almacén que no borra
 * nunca (ADR-0010). Medido en el entorno de test el 2026-09-16.
 *
 * Qué se pierde y qué no: la URL del medio deja de estar obligada a ir cifrada,
 * así que en un despliegue con la web en https habría contenido mixto. Eso ya no
 * lo decide la base: lo decide cómo se publique el almacén. Donde haya TLS, la
 * URL sale https sola, porque la construye `MEDIA_STORAGE_PUBLIC_BASE_URL`.
 * Lo que sí se conserva es que el esquema sea http o https: nada de `file://`,
 * `javascript:` ni rutas relativas.
 */
const upStatements = [
  `ALTER TABLE training.exercise_media DROP CONSTRAINT ck_exercise_media_https`,
  `ALTER TABLE training.exercise_media ADD CONSTRAINT ck_exercise_media_https CHECK (
     url ~ '^https://' OR url ~ '^http://'
   )`,
] as const;

const downStatements = [
  `ALTER TABLE training.exercise_media DROP CONSTRAINT ck_exercise_media_https`,
  `ALTER TABLE training.exercise_media ADD CONSTRAINT ck_exercise_media_https CHECK (
     url ~ '^https://'
     OR url ~ '^http://localhost(:[0-9]+)?/'
     OR url ~ '^http://127\\.0\\.0\\.1(:[0-9]+)?/'
   )`,
] as const;

export const exerciseMediaPlainHttpMigration: DatabaseMigration = {
  id: "202609160003-exercise-media-plain-http",
  description:
    "Allows self-hosted exercise media served over plain http on any host, keeping the scheme restricted to http(s).",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  // La vuelta atrás exige que no queden filas con http fuera de loopback.
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

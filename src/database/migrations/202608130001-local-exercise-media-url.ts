import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Permite que `training.exercise_media.url` apunte a media auto-alojada por el
 * backend sobre http de loopback (p. ej. `http://localhost:3001/media/...`),
 * conservando la exigencia de https para cualquier host real. Habilita el
 * mirroring de imágenes de ejercicios al almacenamiento local sin debilitar la
 * protección contra URLs http externas arbitrarias.
 */
const upStatements = [
  `ALTER TABLE training.exercise_media DROP CONSTRAINT ck_exercise_media_https`,
  `ALTER TABLE training.exercise_media ADD CONSTRAINT ck_exercise_media_https CHECK (
     url ~ '^https://'
     OR url ~ '^http://localhost(:[0-9]+)?/'
     OR url ~ '^http://127\\.0\\.0\\.1(:[0-9]+)?/'
   )`,
] as const;

const downStatements = [
  `ALTER TABLE training.exercise_media DROP CONSTRAINT ck_exercise_media_https`,
  `ALTER TABLE training.exercise_media ADD CONSTRAINT ck_exercise_media_https CHECK (url ~ '^https://')`,
] as const;

export const localExerciseMediaUrlMigration: DatabaseMigration = {
  id: "202608130001-local-exercise-media-url",
  description:
    "Allows self-hosted loopback-http exercise media URLs while keeping https mandatory for real hosts.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  // Rollback restaura https-only; requiere que no existan filas con url de loopback.
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

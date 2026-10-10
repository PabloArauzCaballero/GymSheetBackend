import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Moderación de rutinas, ejercicios privados y comentarios (RF-B1).
 * `moderation.reports` valida `target_kind` y `reason` con CHECK, así que los
 * valores nuevos exigen reemplazar esas restricciones.
 */
const KINDS_OLD = `'STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER'`;
const KINDS_NEW = `${KINDS_OLD},'ROUTINE','EXERCISE','COMMENT'`;
const REASONS_OLD = `'CONTENIDO_SEXUAL','ACOSO','DISCURSO_DE_ODIO','VIOLENCIA','SPAM','PERFIL_FALSO','MENOR_DE_EDAD','DROGAS','OTRO'`;
const REASONS_NEW = `${REASONS_OLD},'EJERCICIO_PELIGROSO','INFORMACION_ENGANOSA','PLAGIO'`;

const replace = (kinds: string, reasons: string): string[] => [
  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN (${kinds}))`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_reason`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_reason
     CHECK (reason IN (${reasons}))`,
];

export const moderationRoutineKindsMigration: DatabaseMigration = {
  id: '202610080004-moderation-routine-kinds',
  description: 'Allow ROUTINE, EXERCISE and COMMENT report targets and their reasons.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, replace(KINDS_NEW, REASONS_NEW)),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, [
      `DELETE FROM moderation.reports WHERE target_kind IN ('ROUTINE','EXERCISE','COMMENT')
         OR reason IN ('EJERCICIO_PELIGROSO','INFORMACION_ENGANOSA','PLAGIO')`,
      ...replace(KINDS_OLD, REASONS_OLD),
    ]),
};

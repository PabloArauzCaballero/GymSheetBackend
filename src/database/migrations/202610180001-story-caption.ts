import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Texto opcional sobre la story (pie de foto). Nulo es lo normal: una story sin
 * texto sigue siendo la de siempre, así que la columna entra sin valor por
 * defecto y sin reescribir filas. El CHECK impide guardar texto vacío o en
 * blanco: «sin texto» se escribe NULL, no "".
 */
const upStatements = [
  `ALTER TABLE profile.stories
     ADD COLUMN caption varchar(200) NULL,
     ADD CONSTRAINT ck_profile_stories_caption_not_blank
       CHECK (caption IS NULL OR btrim(caption) <> '')`,
] as const;

const downStatements = [
  `ALTER TABLE profile.stories
     DROP CONSTRAINT IF EXISTS ck_profile_stories_caption_not_blank,
     DROP COLUMN IF EXISTS caption`,
] as const;

export const storyCaptionMigration: DatabaseMigration = {
  id: "202610180001-story-caption",
  description: "Adds an optional caption to stories.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

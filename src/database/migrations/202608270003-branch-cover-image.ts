import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Imagen de portada del directorio público de sedes: sin ella, cada tarjeta
 * era solo texto — la petición de producto fue que se vea como un listado con
 * fotos (estilo portal de anuncios), no una tabla.
 */
const upStatements = [
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS cover_image_url text`,
] as const;

const downStatements = [
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS cover_image_url`,
] as const;

export const branchCoverImageMigration: DatabaseMigration = {
  id: "202608270003-branch-cover-image",
  description:
    "Adds facilities.branches.cover_image_url so the public gym directory can show a photo per branch.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

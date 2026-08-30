import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * El directorio público solo mostraba los servicios derivados de las salas
 * (entrenamiento, cardio…) y una única foto de portada — se sentía vacío
 * comparado con un portal de anuncios real. Estas dos columnas cubren
 * comodidades (texto libre, no ligado a un tipo de sala) y una galería de
 * fotos adicional por sede.
 */
const upStatements = [
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS amenities text[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS gallery_image_urls text[] NOT NULL DEFAULT '{}'`,
] as const;

const downStatements = [
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS gallery_image_urls`,
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS amenities`,
] as const;

export const branchAmenitiesGalleryMigration: DatabaseMigration = {
  id: "202608270004-branch-amenities-gallery",
  description:
    "Adds facilities.branches.amenities and .gallery_image_urls for a richer public directory listing.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

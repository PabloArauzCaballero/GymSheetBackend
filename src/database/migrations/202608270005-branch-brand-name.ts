import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Varias sedes del directorio público pertenecen a la misma cadena (p. ej.
 * "Megatlon Fitness Club — Centro" y "Megatlon Express — 21 de Mayo" son
 * ambas Megatlon). Sin un campo de marca no hay forma de agruparlas: cada
 * ficha se veía como un negocio aislado aunque comparta dueño con otra sede.
 */
const upStatements = [
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS brand_name varchar(180)`,
  // Índice, no restricción: `NULL` sigue siendo válido para una sede sin
  // cadena declarada, y las consultas de "otras sucursales de la marca" son
  // frecuentes en el directorio público.
  `CREATE INDEX IF NOT EXISTS ix_branches_brand_name ON facilities.branches (brand_name)`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS facilities.ix_branches_brand_name`,
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS brand_name`,
] as const;

export const branchBrandNameMigration: DatabaseMigration = {
  id: "202608270005-branch-brand-name",
  description:
    "Adds facilities.branches.brand_name so sedes belonging to the same chain can be grouped in the public directory.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

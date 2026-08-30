import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Sucursal habitual del socio.
 *
 * El directorio de Comunidad filtraba por `training_location` (gimnasio/casa/
 * aire libre/mixto — una preferencia de entreno), pero eso no dice con quién
 * comparte sede una persona. Nulable: la cuenta puede no tener sucursal
 * asignada todavía (alta sin ese dato, o multi-sede sin una "principal").
 */
const upStatements = [
  `ALTER TABLE public.usuarios
     ADD COLUMN IF NOT EXISTS sede_id uuid REFERENCES facilities.branches(id)`,
  `CREATE INDEX IF NOT EXISTS idx_usuarios_sede_id ON public.usuarios (sede_id)`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS idx_usuarios_sede_id`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS sede_id`,
] as const;

export const userBranchMigration: DatabaseMigration = {
  id: "202608270001-user-branch",
  description:
    "Adds usuarios.sede_id (home branch) so the community directory can filter by branch instead of training-location preference.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

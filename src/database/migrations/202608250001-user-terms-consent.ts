import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Consentimiento de términos y política de privacidad.
 *
 * Es el único punto de la auditoría de Pablo con riesgo legal/de cumplimiento
 * real, así que se registra la marca de tiempo y la versión aceptada, no solo
 * un booleano: si el texto legal cambia más adelante, saber qué versión vio
 * cada cuenta es lo que permite decidir a quién hay que pedirle que vuelva a
 * aceptar. Ambas columnas admiten nulo porque las cuentas creadas antes de
 * este cambio (y el alta de personal, que no pasa por este formulario) nunca
 * lo aceptaron por este camino.
 */
const upStatements = [
  `ALTER TABLE public.usuarios
     ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz`,
  `ALTER TABLE public.usuarios
     ADD COLUMN IF NOT EXISTS terms_version varchar(20)`,
] as const;

const downStatements = [
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS terms_version`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS accepted_terms_at`,
] as const;

export const userTermsConsentMigration: DatabaseMigration = {
  id: "202608250001-user-terms-consent",
  description:
    "Records when and which version of the terms/privacy policy a user account accepted.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

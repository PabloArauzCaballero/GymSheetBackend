import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Incremento de peso preferido para los chips rápidos de registro de series.
 *
 * Estaba fijo en 2.5 kg en el código del móvil — cada gimnasio y cada persona
 * carga sus discos distinto (algunos solo tienen de 1.25 kg, otros solo de 5).
 * Va en la cuenta y no en el perfil antropométrico: es una preferencia de uso
 * de la aplicación, no un dato sobre el cuerpo de la persona.
 */
const upStatements = [
  `ALTER TABLE public.usuarios
     ADD COLUMN IF NOT EXISTS weight_increment_kg numeric(5,2) NOT NULL DEFAULT 2.5`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_weight_increment_kg
     CHECK (weight_increment_kg > 0 AND weight_increment_kg <= 50)`,
] as const;

const downStatements = [
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_weight_increment_kg`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS weight_increment_kg`,
] as const;

export const userWeightIncrementMigration: DatabaseMigration = {
  id: "202608250004-user-weight-increment",
  description:
    "Per-account preferred weight increment for the quick-add chips in set logging, replacing the hardcoded 2.5kg.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

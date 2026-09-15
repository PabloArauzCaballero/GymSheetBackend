import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Fecha de nacimiento en el perfil antropométrico.
 *
 * La edad declarada caduca: quien la guardó con 28 años sigue teniendo 28 en la
 * base un año después. La fecha no caduca, y la edad se calcula al leer.
 *
 * `edad` se conserva a propósito: los perfiles antiguos solo tienen ese dato, y
 * las versiones de la app ya instaladas siguen enviándolo. Al leer se usa la
 * fecha si existe y, si no, la edad guardada.
 *
 * El límite inferior es fijo y no relativo a hoy: una restricción CHECK con
 * `CURRENT_DATE` no es inmutable y puede romper una restauración del volcado.
 * El rango de edad real (12–100) lo valida la API.
 */
const upStatements = [
  `ALTER TABLE public.perfiles_antropometricos
     ADD COLUMN IF NOT EXISTS fecha_nacimiento date`,
  `ALTER TABLE public.perfiles_antropometricos
     ADD CONSTRAINT ck_perfiles_antropometricos_fecha_nacimiento
     CHECK (fecha_nacimiento IS NULL OR fecha_nacimiento >= DATE '1900-01-01')`,
] as const;

const downStatements = [
  `ALTER TABLE public.perfiles_antropometricos
     DROP CONSTRAINT IF EXISTS ck_perfiles_antropometricos_fecha_nacimiento`,
  `ALTER TABLE public.perfiles_antropometricos DROP COLUMN IF EXISTS fecha_nacimiento`,
] as const;

export const profileBirthDateMigration: DatabaseMigration = {
  id: "202609160002-profile-birth-date",
  description:
    "Optional birth date on anthropometric profiles so age is derived instead of stored stale.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

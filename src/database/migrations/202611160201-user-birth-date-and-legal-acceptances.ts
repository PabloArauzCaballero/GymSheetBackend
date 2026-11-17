import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Birth date moves to the account and legal acceptance becomes auditable.
 *
 * 1. `usuarios.fecha_nacimiento` is the single source of a person's age. The
 *    anthropometric profile requires weight and height, so it cannot exist at
 *    signup, which is exactly where the 18+ check has to happen. The value is
 *    backfilled from the profile: the stored date when there is one, otherwise
 *    a date derived from the legacy `edad` (age-accurate today, day-inexact;
 *    existing data is test data). Every reader now uses the account column, so
 *    the profile columns `fecha_nacimiento` and `edad` are dropped here.
 * 2. `auth.terms_acceptances` keeps one row per account, document and version,
 *    with when, from which channel and a keyed hash of the IP (never the raw
 *    IP). The unique key makes acceptance idempotent.
 *
 * Rollback recreates the profile columns (with their original constraints),
 * copies the account birth date back into them and drops the new objects.
 * Acceptance rows are lost on rollback; `usuarios.accepted_terms_at` and
 * `terms_version` are still maintained, so the legacy record survives.
 */
const upStatements = [
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS fecha_nacimiento date`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_fecha_nacimiento
     CHECK (fecha_nacimiento IS NULL OR fecha_nacimiento >= DATE '1900-01-01')`,
  `UPDATE public.usuarios account
      SET fecha_nacimiento = COALESCE(
            profile.fecha_nacimiento,
            (CURRENT_DATE - make_interval(years => profile.edad))::date)
     FROM public.perfiles_antropometricos profile
    WHERE profile.usuario_id = account.id
      AND account.fecha_nacimiento IS NULL
      AND (profile.fecha_nacimiento IS NOT NULL OR profile.edad IS NOT NULL)`,
  `ALTER TABLE public.perfiles_antropometricos
     DROP CONSTRAINT IF EXISTS ck_perfiles_antropometricos_fecha_nacimiento`,
  `ALTER TABLE public.perfiles_antropometricos DROP COLUMN IF EXISTS fecha_nacimiento`,
  `ALTER TABLE public.perfiles_antropometricos DROP COLUMN IF EXISTS edad`,
  `CREATE SCHEMA IF NOT EXISTS auth`,
  `CREATE TABLE auth.terms_acceptances (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     document varchar(20) NOT NULL,
     version varchar(20) NOT NULL,
     accepted_at timestamptz NOT NULL DEFAULT now(),
     channel varchar(10) NOT NULL DEFAULT 'UNKNOWN',
     ip_hmac varchar(64) NULL,
     user_agent varchar(400) NULL,
     CONSTRAINT uq_terms_acceptances_user_document_version UNIQUE (user_id, document, version),
     CONSTRAINT ck_terms_acceptances_document CHECK (document IN ('TERMS', 'PRIVACY')),
     CONSTRAINT ck_terms_acceptances_channel CHECK (channel IN ('WEB', 'IOS', 'ANDROID', 'UNKNOWN'))
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS auth.terms_acceptances`,
  `ALTER TABLE public.perfiles_antropometricos ADD COLUMN IF NOT EXISTS edad integer`,
  `ALTER TABLE public.perfiles_antropometricos
     ADD CONSTRAINT perfiles_antropometricos_edad_check CHECK (edad BETWEEN 12 AND 100)`,
  `ALTER TABLE public.perfiles_antropometricos ADD COLUMN IF NOT EXISTS fecha_nacimiento date`,
  `ALTER TABLE public.perfiles_antropometricos
     ADD CONSTRAINT ck_perfiles_antropometricos_fecha_nacimiento
     CHECK (fecha_nacimiento IS NULL OR fecha_nacimiento >= DATE '1900-01-01')`,
  `UPDATE public.perfiles_antropometricos profile
      SET fecha_nacimiento = account.fecha_nacimiento,
          edad = CASE
                   WHEN date_part('year', age(CURRENT_DATE, account.fecha_nacimiento)) BETWEEN 12 AND 100
                   THEN date_part('year', age(CURRENT_DATE, account.fecha_nacimiento))::int
                 END
     FROM public.usuarios account
    WHERE account.id = profile.usuario_id
      AND account.fecha_nacimiento IS NOT NULL`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_fecha_nacimiento`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS fecha_nacimiento`,
] as const;

export const userBirthDateAndLegalAcceptancesMigration: DatabaseMigration = {
  id: "202611160201-user-birth-date-and-legal-acceptances",
  description:
    "Moves the birth date to usuarios (dropping the profile copies) and adds auditable terms/privacy acceptances.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

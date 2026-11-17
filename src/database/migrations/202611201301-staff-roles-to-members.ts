import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const STAFF_ROLES = `'ADMIN', 'FRONT_DESK', 'COACH', 'ENTRENADOR_EXTERNO'`;
const ROLES_AFTER = `'SYSTEM_ADMIN', 'MODERATOR', 'CLIENTE', 'NEGOCIO'`;

/**
 * Franja 7d (ADR-0029), reversible contraction: the gym has no staff users
 * (ADR-0019), so the legacy staff roles go. Every account still holding one
 * becomes a member (`CLIENTE`): the person keeps their account, workouts and
 * profile, and nothing is erased. The ledger `retired.staff_role_conversions`
 * records each converted account and its previous role, so the rollback gives
 * those accounts (and only those still `CLIENTE`) their role back. Then the
 * `usuarios.rol` CHECK is narrowed to the roles in use.
 *
 * Idempotent: a second `up` finds no staff role and keeps the first ledger.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS retired`,
  `CREATE TABLE IF NOT EXISTS retired.staff_role_conversions (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios (id) ON DELETE CASCADE,
     previous_role varchar(30) NOT NULL CHECK (previous_role IN (${STAFF_ROLES})),
     converted_at timestamptz NOT NULL DEFAULT now()
   )`,
  `INSERT INTO retired.staff_role_conversions (user_id, previous_role)
   SELECT u.id, u.rol FROM public.usuarios u WHERE u.rol IN (${STAFF_ROLES})
   ON CONFLICT (user_id) DO NOTHING`,
  `UPDATE public.usuarios SET rol = 'CLIENTE', updated_at = now() WHERE rol IN (${STAFF_ROLES})`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN (${ROLES_AFTER}))`,
] as const;

const downStatements = [
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN ('SYSTEM_ADMIN', 'MODERATOR', ${STAFF_ROLES}, 'CLIENTE', 'NEGOCIO'))`,
  `UPDATE public.usuarios u SET rol = l.previous_role, updated_at = now()
     FROM retired.staff_role_conversions l
    WHERE l.user_id = u.id AND u.rol = 'CLIENTE'`,
  `DROP TABLE IF EXISTS retired.staff_role_conversions`,
] as const;

export const staffRolesToMembersMigration: DatabaseMigration = {
  id: "202611201301-staff-roles-to-members",
  description:
    "Converts every legacy staff account (ADMIN, FRONT_DESK, COACH, ENTRENADOR_EXTERNO) into a member, records the previous role for the rollback and narrows the usuarios.rol CHECK (ADR-0029). Reversible.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

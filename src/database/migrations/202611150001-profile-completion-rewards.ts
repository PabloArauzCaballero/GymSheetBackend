import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Puntos por completar el perfil (la senda, `docs/progression/la-senda.md` §5.1).
 *
 * - `usuarios.bio`: unas líneas sobre ti, visibles en la carta de Conocer.
 * - `progression.profile_completion_awards`: libro de solo inserción. Una fila
 *   por persona y dato del perfil; la clave primaria es lo que hace idempotente
 *   el premio (`INSERT … ON CONFLICT DO NOTHING`). `points` guarda lo que valía
 *   el dato al ganarlo, así que cambiar el catálogo no reescribe lo ya ganado.
 *   `tenant_id` es el gimnasio de la cuenta en ese momento, para auditoría.
 *
 * Solo DDL, y breve: `ADD COLUMN` toma ACCESS EXCLUSIVE sobre `usuarios` hasta
 * que la transacción de la migración termina. Lo que cada socio ya tenía se
 * anota a coste cero en `202611150005-backfill-profile-completion-awards`, en
 * su propia transacción, para no bloquear logins mientras se recorre la tabla.
 */
const upStatements = [
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS bio varchar(160) NULL`,
  `CREATE TABLE IF NOT EXISTS progression.profile_completion_awards (
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     item_code varchar(32) NOT NULL,
     points integer NOT NULL,
     tenant_id varchar(60) NULL,
     awarded_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, item_code),
     CONSTRAINT ck_profile_completion_awards_points CHECK (points >= 0)
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS progression.profile_completion_awards`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS bio`,
] as const;

export const profileCompletionRewardsMigration: DatabaseMigration = {
  id: "202611150001-profile-completion-rewards",
  description: "Adds usuarios.bio and the insert-only ledger of profile-completion points.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

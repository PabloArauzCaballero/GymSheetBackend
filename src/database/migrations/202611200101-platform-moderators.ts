import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Social moderation moves from gym staff to the central REPP team (ADR-0018).
 *
 * 1. `usuarios.rol` admits `MODERATOR`, the platform moderator role.
 * 2. The gym-level `moderation:read` / `moderation:act` grants are retired:
 *    the code no longer checks or grants them. They are copied to
 *    `admin.retired_permission_grants` before being deleted, so rollback can
 *    put back exactly what existed.
 * 3. Cases claimed by an account that is not a platform role go back to the
 *    queue: a gym admin cannot resolve or release them any more, and leaving
 *    them claimed would lock the platform team out of them.
 *
 * Rollback restores the two permission rows and every retired grant, drops the
 * copy, turns every `MODERATOR` back into `CLIENTE` (demoting is the safe
 * direction: promoting to `ADMIN` would hand out gym powers) and restores the
 * previous CHECK. Released claims are not re-claimed: a claim is a transient
 * lock and the case stays open in the queue either way.
 */
const upStatements = [
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_rol
     CHECK (rol IN ('SYSTEM_ADMIN', 'MODERATOR', 'ADMIN', 'CLIENTE', 'ENTRENADOR_EXTERNO', 'COACH', 'FRONT_DESK'))`,

  `CREATE TABLE admin.retired_permission_grants (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     permission_key varchar(80) NOT NULL,
     granted_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     granted_at timestamptz NOT NULL,
     expires_at timestamptz,
     retired_at timestamptz NOT NULL DEFAULT now(),
     retired_by_migration varchar(120) NOT NULL
   )`,
  `INSERT INTO admin.retired_permission_grants
     (id, user_id, permission_key, granted_by_user_id, granted_at, expires_at, retired_by_migration)
   SELECT id, user_id, permission_key, granted_by_user_id, granted_at, expires_at,
          '202611200101-platform-moderators'
     FROM admin.user_permissions
    WHERE permission_key IN ('moderation:read', 'moderation:act')`,
  `DELETE FROM admin.user_permissions WHERE permission_key IN ('moderation:read', 'moderation:act')`,
  `DELETE FROM admin.permissions WHERE key IN ('moderation:read', 'moderation:act')`,

  `UPDATE moderation.reports r
      SET status = 'PENDIENTE', claimed_by_user_id = NULL, claimed_at = NULL
    WHERE r.status = 'EN_REVISION'
      AND NOT EXISTS (
        SELECT 1 FROM public.usuarios u
         WHERE u.id = r.claimed_by_user_id AND u.rol IN ('SYSTEM_ADMIN', 'MODERATOR'))`,
] as const;

const downStatements = [
  `INSERT INTO admin.permissions (key, label, description, domain) VALUES
     ('moderation:read', 'Ver moderación', 'Consultar la cola de reportes y el historial de sanciones.', 'moderation'),
     ('moderation:act', 'Resolver moderación', 'Resolver reportes: ocultar contenido, advertir y suspender cuentas.', 'moderation')
   ON CONFLICT (key) DO NOTHING`,
  `INSERT INTO admin.user_permissions
     (id, user_id, permission_key, granted_by_user_id, granted_at, expires_at)
   SELECT id, user_id, permission_key, granted_by_user_id, granted_at, expires_at
     FROM admin.retired_permission_grants
    WHERE retired_by_migration = '202611200101-platform-moderators'
   ON CONFLICT DO NOTHING`,
  `DROP TABLE IF EXISTS admin.retired_permission_grants`,

  `UPDATE public.usuarios SET rol = 'CLIENTE' WHERE rol = 'MODERATOR'`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_rol
     CHECK (rol IN ('SYSTEM_ADMIN', 'ADMIN', 'CLIENTE', 'ENTRENADOR_EXTERNO', 'COACH', 'FRONT_DESK'))`,
] as const;

export const platformModeratorsMigration: DatabaseMigration = {
  id: "202611200101-platform-moderators",
  description:
    "Platform MODERATOR role, retirement of the gym-level moderation grants and release of the cases claimed by gym staff.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

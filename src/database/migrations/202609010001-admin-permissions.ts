import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS admin`,
  `CREATE TABLE admin.permissions (
     key varchar(80) PRIMARY KEY,
     label varchar(160) NOT NULL,
     description text NOT NULL,
     domain varchar(60) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_admin_permission_key_format CHECK (key ~ '^[a-z][a-z-]*:[a-z][a-z-]*$')
   )`,
  `CREATE TABLE admin.user_permissions (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     permission_key varchar(80) NOT NULL REFERENCES admin.permissions(key) ON DELETE CASCADE,
     granted_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     granted_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_admin_user_permission UNIQUE (user_id, permission_key)
   )`,
  `CREATE INDEX ix_admin_user_permissions_user ON admin.user_permissions(user_id)`,
  `CREATE INDEX ix_admin_user_permissions_expiry ON admin.user_permissions(expires_at)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS admin.user_permissions`,
  `DROP TABLE IF EXISTS admin.permissions`,
] as const;

export const adminPermissionsMigration: DatabaseMigration = {
  id: '202609010001-admin-permissions',
  description: 'Adds a granular, code-defined admin permission catalog and per-user grants layered on top of the coarse role model.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

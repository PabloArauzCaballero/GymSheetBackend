import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Catálogo de gimnasios, y el rol que opera por encima de ellos.
 *
 * Hasta ahora `usuarios.tenant_id` era texto libre sin tabla detrás: el
 * registro es público y aceptaba cualquier identificador con la forma correcta,
 * así que bastaba conocer —o adivinar— la clave de un gimnasio para entrar en
 * su perímetro social (directorio de socios, chat, stories, clasificación). La
 * migración anterior (`202608180001-user-tenant`) dejó escrito que darle una
 * tabla «sería inventar un modelo que nadie mantiene todavía»; ahora sí lo
 * mantiene alguien, porque el Admin Portal necesita administrarlos.
 *
 * El respaldo de datos importa tanto como la tabla: se siembran primero los
 * gimnasios que YA existen en `usuarios`, y sólo después se ata la clave
 * foránea. Al revés, la migración fallaría en cualquier base con cuentas
 * reales, que es justo donde tiene que funcionar.
 *
 * `SYSTEM_ADMIN` se añade aquí porque nace del mismo problema: `ADMIN` era
 * supra-inquilino de facto —ninguna ruta `admin/*` comprobaba el gimnasio— y
 * separar los dos roles es lo que permite cerrar el agujero sin quitarle a una
 * consola de sistema una capacidad que sí necesita.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS public.tenants (
     id            varchar(60)  PRIMARY KEY,
     nombre        varchar(180) NOT NULL,
     estado        varchar(20)  NOT NULL DEFAULT 'ACTIVO',
     created_at    timestamptz  NOT NULL DEFAULT now(),
     updated_at    timestamptz  NOT NULL DEFAULT now(),
     CONSTRAINT ck_tenants_id CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
     CONSTRAINT ck_tenants_estado CHECK (estado IN ('ACTIVO', 'INACTIVO'))
   )`,

  // El gimnasio de referencia: es el que resuelve `DEFAULT_TENANT_ID` para toda
  // cuenta sin `tenant_id` propio, así que tiene que existir en el catálogo o
  // la clave foránea dejaría fuera precisamente a las cuentas más antiguas.
  `INSERT INTO public.tenants (id, nombre)
     VALUES ('default', 'GymSheet')
     ON CONFLICT (id) DO NOTHING`,

  // Respaldo: cada gimnasio ya presente en las cuentas entra al catálogo con su
  // propio identificador como nombre provisional. Renombrarlos es trabajo de
  // administración, no de esquema.
  `INSERT INTO public.tenants (id, nombre)
     SELECT DISTINCT u.tenant_id, u.tenant_id
       FROM public.usuarios u
      WHERE u.tenant_id IS NOT NULL
        AND u.tenant_id ~ '^[a-z0-9][a-z0-9-]*$'
     ON CONFLICT (id) DO NOTHING`,

  // Ahora sí: con el catálogo ya poblado, la clave foránea no puede rechazar
  // ninguna fila existente. `ON DELETE RESTRICT` porque borrar un gimnasio con
  // socios dentro es una decisión de negocio, no una cascada silenciosa.
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT fk_usuarios_tenant
     FOREIGN KEY (tenant_id) REFERENCES public.tenants (id)
     ON UPDATE CASCADE ON DELETE RESTRICT`,

  // El rol nuevo. El CHECK de `usuarios.rol` enumera los valores admitidos, así
  // que hay que reescribirlo para que acepte uno más.
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_rol
     CHECK (rol IN ('SYSTEM_ADMIN', 'ADMIN', 'CLIENTE', 'ENTRENADOR_EXTERNO', 'COACH', 'FRONT_DESK'))`,
] as const;

const downStatements = [
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  // Al revertir, cualquier cuenta SYSTEM_ADMIN dejaría de satisfacer el CHECK
  // anterior: se degradan a ADMIN antes de restaurarlo. Degradar es la
  // dirección segura; lo contrario sería conceder privilegios al revertir.
  `UPDATE public.usuarios SET rol = 'ADMIN' WHERE rol = 'SYSTEM_ADMIN'`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_rol
     CHECK (rol IN ('ADMIN', 'CLIENTE', 'ENTRENADOR_EXTERNO', 'COACH', 'FRONT_DESK'))`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS fk_usuarios_tenant`,
  `DROP TABLE IF EXISTS public.tenants`,
] as const;

export const tenantsAndSystemAdminMigration: DatabaseMigration = {
  id: "202608290001-tenants-and-system-admin",
  description:
    "Gym catalogue with a foreign key from user accounts, plus the cross-tenant SYSTEM_ADMIN role.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

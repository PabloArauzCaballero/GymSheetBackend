import { env } from "../../config/env";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Gimnasio propietario de sucursales, equipos y archivos.
 *
 * Estas tres tablas nacieron antes de la multi-marca y no tenían NINGÚN camino
 * hasta un gimnasio: ni columna propia ni clave foránea a `usuarios`. La cadena
 * `equipos_gym → equipment_assignments → rooms → branches` tampoco servía,
 * porque `branches` tampoco lo tenía y un equipo sin asignar no llega ni a esa
 * cadena. Sin este dato no se puede escribir el filtro: `GET /admin/facilities`
 * devolvía las sucursales de todos los gimnasios y no había `where` posible.
 *
 * El orden importa y es el mismo que en el catálogo de gimnasios: columna,
 * respaldo de las filas que YA existen, y sólo entonces la foránea y el NOT
 * NULL. Al revés fallaría en cualquier base con datos reales, que es donde
 * tiene que funcionar.
 *
 * `media.files` es el caso distinto de los tres: se queda NULLABLE a propósito.
 * Ahí conviven dos niveles reales — lo que sube un gimnasio (`MANAGED`, suyo) y
 * lo que se importa de catálogos externos de ejercicios (compartido) — y forzar
 * un dueño al material importado lo duplicaría por cada gimnasio. Nulo =
 * compartido, el mismo convenio que ya usa el catálogo de progresión.
 *
 * `DEFAULT_TENANT_ID` (aquí `topfitness`) es el destino del respaldo: es el
 * único gimnasio al que estas filas han podido pertenecer, porque hasta ahora
 * no había forma de crearlas en nombre de otro.
 */
const defaultTenantId = env.DEFAULT_TENANT_ID;

/**
 * Interpolar el identificador es seguro aquí: `DEFAULT_TENANT_ID` lo valida Zod
 * contra `^[a-z0-9][a-z0-9-]*$` al arrancar, así que no puede contener comillas
 * ni espacios. El ayudante de migraciones ejecuta SQL crudo sin sustituciones.
 */
const upStatements = [
  `INSERT INTO public.tenants (id, nombre)
     VALUES ('${defaultTenantId}', '${defaultTenantId}')
     ON CONFLICT (id) DO NOTHING`,

  // ───────────────────────────────────────────────────────────── sucursales
  `ALTER TABLE facilities.branches
     ADD COLUMN IF NOT EXISTS tenant_id varchar(60)`,
  `UPDATE facilities.branches
      SET tenant_id = '${defaultTenantId}'
    WHERE tenant_id IS NULL`,
  `ALTER TABLE facilities.branches
     ALTER COLUMN tenant_id SET DEFAULT '${defaultTenantId}'`,
  `ALTER TABLE facilities.branches
     ALTER COLUMN tenant_id SET NOT NULL`,
  `ALTER TABLE facilities.branches
     ADD CONSTRAINT fk_branches_tenant
     FOREIGN KEY (tenant_id) REFERENCES public.tenants (id)
     ON UPDATE CASCADE ON DELETE RESTRICT`,
  `CREATE INDEX IF NOT EXISTS ix_branches_tenant
     ON facilities.branches (tenant_id)`,

  // El código de sucursal era único en toda la instalación. Con varios
  // gimnasios eso significa que el primero que use `centro-1` se lo queda para
  // todos, así que la unicidad pasa a ser por gimnasio.
  `ALTER TABLE facilities.branches DROP CONSTRAINT IF EXISTS branches_code_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_tenant_code
     ON facilities.branches (tenant_id, code)`,

  // ───────────────────────────────────────────────────────────────── equipos
  // Columna propia y no un salto por `equipment_assignments`: un equipo recién
  // dado de alta y todavía sin sala no tiene asignación, y sin columna se
  // quedaría fuera de todos los listados de su propio gimnasio.
  `ALTER TABLE public.equipos_gym
     ADD COLUMN IF NOT EXISTS tenant_id varchar(60)`,
  `UPDATE public.equipos_gym
      SET tenant_id = '${defaultTenantId}'
    WHERE tenant_id IS NULL`,
  `ALTER TABLE public.equipos_gym
     ALTER COLUMN tenant_id SET DEFAULT '${defaultTenantId}'`,
  `ALTER TABLE public.equipos_gym
     ALTER COLUMN tenant_id SET NOT NULL`,
  `ALTER TABLE public.equipos_gym
     ADD CONSTRAINT fk_equipos_gym_tenant
     FOREIGN KEY (tenant_id) REFERENCES public.tenants (id)
     ON UPDATE CASCADE ON DELETE RESTRICT`,
  `CREATE INDEX IF NOT EXISTS ix_equipos_gym_tenant
     ON public.equipos_gym (tenant_id)`,

  // ──────────────────────────────────────────────────────────────── archivos
  // Sin NOT NULL: el nulo es un valor con significado (compartido).
  `ALTER TABLE media.files
     ADD COLUMN IF NOT EXISTS tenant_id varchar(60)`,
  `UPDATE media.files
      SET tenant_id = '${defaultTenantId}'
    WHERE tenant_id IS NULL
      AND source_type = 'MANAGED'`,
  `ALTER TABLE media.files
     ADD CONSTRAINT fk_media_files_tenant
     FOREIGN KEY (tenant_id) REFERENCES public.tenants (id)
     ON UPDATE CASCADE ON DELETE RESTRICT`,
  `CREATE INDEX IF NOT EXISTS ix_media_files_tenant
     ON media.files (tenant_id)`,
] as const;

/**
 * Revertir devuelve la unicidad global del código de sucursal antes de soltar
 * las columnas: si quedaran dos gimnasios con el mismo código, restaurarla
 * fallaría, y es preferible que falle a que se pierda una de las dos filas.
 */
const downStatements = [
  `DROP INDEX IF EXISTS media.ix_media_files_tenant`,
  `ALTER TABLE media.files DROP CONSTRAINT IF EXISTS fk_media_files_tenant`,
  `ALTER TABLE media.files DROP COLUMN IF EXISTS tenant_id`,

  `DROP INDEX IF EXISTS public.ix_equipos_gym_tenant`,
  `ALTER TABLE public.equipos_gym DROP CONSTRAINT IF EXISTS fk_equipos_gym_tenant`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS tenant_id`,

  `DROP INDEX IF EXISTS facilities.ux_branches_tenant_code`,
  `DROP INDEX IF EXISTS facilities.ix_branches_tenant`,
  `ALTER TABLE facilities.branches DROP CONSTRAINT IF EXISTS fk_branches_tenant`,
  `ALTER TABLE facilities.branches DROP COLUMN IF EXISTS tenant_id`,
  `ALTER TABLE facilities.branches
     ADD CONSTRAINT branches_code_key UNIQUE (code)`,
] as const;

export const facilitiesEquipmentMediaTenantMigration: DatabaseMigration = {
  id: "202608300002-facilities-equipment-media-tenant",
  description:
    "Owning gym on branches, equipment and media files so admin listings can be scoped; media keeps null for shared catalogue assets.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

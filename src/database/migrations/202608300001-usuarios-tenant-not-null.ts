import { env } from "../../config/env";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Deja `usuarios.tenant_id` sin nulos.
 *
 * El nulo se admitió cuando la columna nació (`202608180001-user-tenant`)
 * porque las cuentas existentes no podían quedar inválidas de golpe. El precio
 * fue que «sin gimnasio» y «el gimnasio de referencia» son el mismo estado
 * escrito de dos formas, y el código acabó tratándolo de las dos maneras a la
 * vez: las comprobaciones de una cuenta suelta resuelven el nulo contra
 * `DEFAULT_TENANT_ID`, pero un `WHERE tenant_id = 'topfitness'` no devuelve una
 * fila con nulo.
 *
 * La discrepancia no abre el perímetro —falla cerrando— pero deja al
 * administrador del gimnasio de referencia sin ver a sus socios más antiguos,
 * que son justo los que llevan más tiempo. Se comprobó en la base local: de 55
 * cuentas, 12 tenían nulo y quedaban fuera de todos los listados.
 *
 * El respaldo usa `DEFAULT_TENANT_ID` y no la cadena `default` a propósito: es
 * el valor al que el código ya hacía caer esas cuentas, así que escribirlo no
 * las mueve de sitio, sólo hace explícito dónde estaban. En esta instalación
 * ese valor es `topfitness`, no `default`.
 */
const defaultTenantId = env.DEFAULT_TENANT_ID;

const upStatements = [
  // El gimnasio de referencia tiene que estar en el catálogo antes de que
  // ninguna cuenta lo apunte: la clave foránea la añadió la migración anterior.
  // Si esa migración sólo sembró 'default' y aquí el de referencia es otro,
  // este INSERT es lo que evita que el respaldo choque contra la foránea.
  `INSERT INTO public.tenants (id, nombre)
     VALUES ('${defaultTenantId}', '${defaultTenantId}')
     ON CONFLICT (id) DO NOTHING`,

  `UPDATE public.usuarios
      SET tenant_id = '${defaultTenantId}'
    WHERE tenant_id IS NULL`,

  // El defecto en la columna evita que una inserción que omita el gimnasio
  // vuelva a crear nulos; el NOT NULL evita que alguien lo escriba a mano.
  `ALTER TABLE public.usuarios
     ALTER COLUMN tenant_id SET DEFAULT '${defaultTenantId}'`,
  `ALTER TABLE public.usuarios
     ALTER COLUMN tenant_id SET NOT NULL`,
] as const;

/**
 * Revertir sólo afloja la restricción. Los nulos NO se restauran: no se sabe
 * cuáles eran, y devolver a nulo cuentas que sí declararon el gimnasio de
 * referencia sería inventar datos.
 */
const downStatements = [
  `ALTER TABLE public.usuarios
     ALTER COLUMN tenant_id DROP NOT NULL`,
  `ALTER TABLE public.usuarios
     ALTER COLUMN tenant_id DROP DEFAULT`,
] as const;

export const usuariosTenantNotNullMigration: DatabaseMigration = {
  id: "202608300001-usuarios-tenant-not-null",
  description:
    "Backfill null user tenants to the default gym and forbid nulls, so scope filters and per-account checks agree.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Gimnasio al que pertenece cada cuenta.
 *
 * El cliente móvil no puede resolver la marca por la URL como hace la web: se
 * instala una sola aplicación y la identidad tiene que salir de quién ha
 * iniciado sesión. Sin este dato, la aplicación solo puede mostrar la marca
 * genérica a todo el mundo.
 *
 * La columna es opcional a propósito. Una instalación de un solo gimnasio no
 * necesita declararla, y las cuentas que ya existen no pueden quedar en un
 * estado inválido por añadir multi-marca; sin valor, el cliente cae en la
 * identidad de referencia.
 *
 * Guarda el identificador del catálogo (`topfitness`), no una clave foránea:
 * las marcas viven hoy en el código compartido de las aplicaciones y darles una
 * tabla antes de que exista administración de gimnasios sería inventar un
 * modelo que nadie mantiene todavía.
 */
const upStatements = [
  `ALTER TABLE public.usuarios
     ADD COLUMN IF NOT EXISTS tenant_id varchar(60)`,
  // Minúsculas y sin espacios: es la misma clave que viaja en la URL de acceso
  // de la web, y dos grafías distintas del mismo gimnasio serían dos gimnasios.
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_tenant_id
     CHECK (tenant_id IS NULL OR tenant_id ~ '^[a-z0-9][a-z0-9-]*$')`,
  // El arranque de la aplicación consulta la cuenta por id; el índice sirve a
  // los listados administrativos por gimnasio, que es la consulta que crecerá.
  `CREATE INDEX IF NOT EXISTS ix_usuarios_tenant ON public.usuarios (tenant_id)`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS public.ix_usuarios_tenant`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_tenant_id`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS tenant_id`,
] as const;

export const userTenantMigration: DatabaseMigration = {
  id: "202608180001-user-tenant",
  description:
    "Optional tenant identifier on user accounts so the mobile client can resolve the gym's brand from the signed-in user.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

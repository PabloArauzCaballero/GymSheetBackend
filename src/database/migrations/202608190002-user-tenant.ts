import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * A qué gimnasio pertenece cada cuenta.
 *
 * La aplicación móvil ya sabía pintarse con la marca del inquilino, pero
 * esperaba que el inicio de sesión le dijera cuál, y nadie se lo decía: la web
 * lo resuelve por la URL y el teléfono no tiene URL. Se instala una sola
 * aplicación, así que el gimnasio sólo puede saberse por la cuenta.
 *
 * Nulo significa la identidad de referencia, que es lo correcto para las
 * cuentas que ya existen y para cualquiera que no pertenezca a un gimnasio con
 * marca propia. Por eso la columna es opcional y no hay valor por defecto: no
 * es un dato que falte, es uno que no aplica.
 *
 * Texto y no clave foránea a propósito. El catálogo de inquilinos vive hoy en
 * el código compartido con la web --sus colores y su logotipo son diseño, no
 * datos--, y crear una tabla para replicarlo obligaría a mantener dos verdades
 * sincronizadas a mano. Cuando el catálogo pase a la base de datos, esta
 * columna se convertirá en la clave foránea correspondiente.
 */
/**
 * Idempotente a propósito. Una rama paralela añadió esta misma columna en
 * `202608180001-user-tenant`, y los ids de migración son inmutables tras el
 * despliegue: ninguna de las dos puede borrarse, así que la de id mayor tiene
 * que poder correr detrás de la otra sin romperse. Con `IF NOT EXISTS` los
 * tres escenarios funcionan: base nueva (la de id menor crea la columna y ésta
 * no hace nada), base migrada sólo por esta rama (crea la columna y la otra
 * añade después el CHECK que falta), y base migrada sólo por la otra rama
 * (ésta no hace nada).
 */
const upStatements = [
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tenant_id varchar(40)`,
  // Buscar los usuarios de un gimnasio es la consulta que hará cualquier
  // pantalla de administración por inquilino.
  `CREATE INDEX IF NOT EXISTS ix_usuarios_tenant ON usuarios (tenant_id) WHERE tenant_id IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS ix_usuarios_tenant`,
  `ALTER TABLE usuarios DROP COLUMN IF EXISTS tenant_id`,
] as const;

export const userTenantMigration: DatabaseMigration = {
  id: "202608190002-user-tenant",
  description:
    "Tenant a user belongs to, so the mobile app can adopt the gym's brand at sign-in.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

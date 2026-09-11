import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Lo que falta para poder responder tres preguntas que el socio ya puede
 * hacerse pero la API todavía no sabe contestar: quién me dio like, quién vio
 * mi perfil y quién me descartó.
 *
 * No crea ninguna tabla. Los tres datos ya se están guardando —
 * `social.connections`, `profile.profile_views` y `social.discovery_passes`—
 * y dos de las tres consultas ya tienen índice que las sostiene
 * (`ix_connections_addressee`, `ix_profile_views_viewed_user`). Faltan dos
 * cosas:
 *
 * 1. El índice de `discovery_passes` existente es `(viewer_id, created_at)`:
 *    sirve para «qué descarté yo», que es como se escribió la tabla, pero la
 *    pregunta nueva es la contraria —«quién me descartó a mí»— y contra ese
 *    índice es un recorrido completo. El nuevo índice invierte la pareja.
 *
 * 2. Los índices de `connections` son `(addressee_id, status)` y
 *    `(requester_id, status)`: sirven para filtrar, pero no llevan la fecha,
 *    así que «los likes pendientes, más recientes primero» obliga a leer todas
 *    las filas que casan y ordenarlas en memoria. Medido con `EXPLAIN
 *    (ANALYZE)` sobre 16 000 conexiones: `Bitmap Heap Scan` de 3 000 filas y
 *    `top-N heapsort` para devolver 20. El coste crece con los likes
 *    pendientes acumulados, no con el tamaño de la página. Los dos índices
 *    nuevos añaden `created_at DESC` y el orden sale del propio índice.
 *
 * 3. `newSinceLastCheck` necesita saber cuándo se miró la lista por última vez.
 *    Va en `social.profile_settings` y no en una tabla nueva porque es
 *    exactamente lo que esa tabla ya es: los ajustes sociales de una persona,
 *    una fila por usuario. La columna es nullable a propósito — «nunca la ha
 *    abierto» y «la abrió y no había nada» son estados distintos, y sólo el
 *    primero justifica enseñar todo como nuevo.
 */
const upStatements = [
  `CREATE INDEX IF NOT EXISTS ix_discovery_passes_target_recent
     ON social.discovery_passes (target_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_connections_addressee_recent
     ON social.connections (addressee_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_connections_requester_recent
     ON social.connections (requester_id, status, created_at DESC)`,
  `ALTER TABLE social.profile_settings
     ADD COLUMN IF NOT EXISTS profile_views_checked_at timestamptz NULL`,
] as const;

const downStatements = [
  `ALTER TABLE social.profile_settings DROP COLUMN IF EXISTS profile_views_checked_at`,
  `DROP INDEX IF EXISTS social.ix_connections_requester_recent`,
  `DROP INDEX IF EXISTS social.ix_connections_addressee_recent`,
  `DROP INDEX IF EXISTS social.ix_discovery_passes_target_recent`,
] as const;

export const socialInteractionsMigration: DatabaseMigration = {
  id: "202609110001-social-interactions",
  description:
    "Indexes that carry the sort key for likes and passes, plus a last-checked marker, so interactions can be listed.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

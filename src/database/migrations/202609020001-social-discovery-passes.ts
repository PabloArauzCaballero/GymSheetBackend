import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Descartes de la baraja de descubrimiento (el «pass» del swipe).
 *
 * Un «like» ya tiene dónde vivir: es una fila de `social.connections`, con su
 * estado y su unicidad por pareja. Un «pass» no, y sin persistirlo la baraja
 * volvería a mostrar mañana a quien alguien descartó hoy — que es justo lo que
 * un swipe promete que no pasará.
 *
 * La tabla es deliberadamente mínima: la clave primaria compuesta
 * `(viewer_id, target_id)` es a la vez el índice único que hace el pass
 * idempotente y el índice que resuelve la exclusión de la baraja
 * (`WHERE viewer_id = :viewer AND target_id = u.id`). El pass NO es simétrico:
 * que A descarte a B no descarta a A para B, así que no se normaliza la pareja
 * con `LEAST/GREATEST` como en `connections`.
 *
 * El segundo índice sirve a otra consulta distinta: «cuál fue el último swipe
 * de esta persona» (deshacer), que ordena por fecha dentro de un solo viewer.
 */
const upStatements = [
  `CREATE TABLE social.discovery_passes (
     viewer_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     target_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT pk_discovery_passes PRIMARY KEY (viewer_id, target_id),
     CONSTRAINT ck_discovery_passes_not_self CHECK (viewer_id <> target_id)
   )`,
  `CREATE INDEX ix_discovery_passes_viewer_recent
     ON social.discovery_passes (viewer_id, created_at DESC)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS social.discovery_passes`] as const;

export const socialDiscoveryPassesMigration: DatabaseMigration = {
  id: "202609020001-social-discovery-passes",
  description: "Persistent swipe passes so the discovery deck never shows a discarded member again.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

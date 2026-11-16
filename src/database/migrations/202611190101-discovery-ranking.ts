import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Local "Conocer" ranking (franja 5).
 *
 * 1. `usuarios.verified_at`: identity verification (franja 6 fills it). Null
 *    means "not verified", so the verification factor is 0 until then.
 * 2. `usuarios.last_active_at` + `usuarios.active_hours`: app activity written
 *    at most every 5 minutes per account. `active_hours[h + 1]` keeps the last
 *    local date the person was active during hour `h`, which is all the
 *    "active at the same time" factor needs (overlap over the last 14 days)
 *    without an event table.
 * 3. `social.ranking_config`: versioned weights. Several active versions split
 *    traffic by a stable hash of the viewer id (A/B); code keeps the same
 *    defaults when the table is empty.
 * 4. `social.discovery_impressions.ranking_version/ranking_position`: which
 *    configuration served a card and where, for like/match metrics.
 * 5. Indexes for the candidate pool (recent activity, new accounts, cross-gym
 *    consent). Evidence: docs/performance/discovery-ranking.md.
 *
 * Rollback drops every object added here; the dropped columns hold derived or
 * not-yet-used data only.
 */
const weightColumns = [
  "w_activity",
  "w_mutual",
  "w_distance",
  "w_intent",
  "w_affinity",
  "w_verification",
  "w_novelty",
] as const;

const upStatements = [
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS verified_at timestamptz NULL`,
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS last_active_at timestamptz NULL`,
  `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS active_hours date[] NULL`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_active_hours
     CHECK (active_hours IS NULL OR cardinality(active_hours) = 24)`,
  `CREATE TABLE social.ranking_config (
     version varchar(32) PRIMARY KEY,
     ${weightColumns.map((column) => `${column} numeric(4,3) NOT NULL`).join(",\n     ")},
     exploration_share numeric(3,2) NOT NULL DEFAULT 0.10,
     traffic_weight smallint NOT NULL DEFAULT 100,
     active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_ranking_config_version CHECK (version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
     CONSTRAINT ck_ranking_config_weights CHECK (${weightColumns
       .map((column) => `${column} BETWEEN 0 AND 1`)
       .join(" AND ")}),
     CONSTRAINT ck_ranking_config_exploration CHECK (exploration_share BETWEEN 0 AND 0.5),
     CONSTRAINT ck_ranking_config_traffic CHECK (traffic_weight BETWEEN 0 AND 10000)
   )`,
  `INSERT INTO social.ranking_config
     (version, ${weightColumns.join(", ")}, exploration_share, traffic_weight)
   VALUES ('v1', 0.25, 0.20, 0.15, 0.10, 0.15, 0.10, 0.05, 0.10, 100)
   ON CONFLICT (version) DO NOTHING`,
  `ALTER TABLE social.discovery_impressions
     ADD COLUMN IF NOT EXISTS ranking_version varchar(32) NULL,
     ADD COLUMN IF NOT EXISTS ranking_position smallint NULL`,
  // Main pool: the most recently active verified members of a gym.
  `CREATE INDEX IF NOT EXISTS ix_usuarios_discovery_active
     ON public.usuarios (tenant_id, last_active_at DESC NULLS LAST, id)
     WHERE estado = 'ACTIVO' AND email_verified_at IS NOT NULL`,
  // Exploration pool: accounts younger than 7 days.
  `CREATE INDEX IF NOT EXISTS ix_usuarios_discovery_new
     ON public.usuarios (tenant_id, created_at DESC)
     WHERE estado = 'ACTIVO' AND email_verified_at IS NOT NULL`,
  // Cross-gym pool: only members who opened discovery to other gyms.
  `CREATE INDEX IF NOT EXISTS ix_profile_settings_cross_gym
     ON social.profile_settings (user_id)
     WHERE profile_enabled AND cross_gym_enabled`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS social.ix_profile_settings_cross_gym`,
  `DROP INDEX IF EXISTS public.ix_usuarios_discovery_new`,
  `DROP INDEX IF EXISTS public.ix_usuarios_discovery_active`,
  `ALTER TABLE social.discovery_impressions
     DROP COLUMN IF EXISTS ranking_position,
     DROP COLUMN IF EXISTS ranking_version`,
  `DROP TABLE IF EXISTS social.ranking_config`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_active_hours`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS active_hours`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS last_active_at`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS verified_at`,
] as const;

export const discoveryRankingMigration: DatabaseMigration = {
  id: "202611190101-discovery-ranking",
  description:
    "Adds activity, verification and versioned ranking configuration for the local Conocer ranking.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

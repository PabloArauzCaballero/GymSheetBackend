import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.discovery_impressions (
     id uuid PRIMARY KEY,
     viewer_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     target_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     feature_codes text[] NOT NULL DEFAULT '{}',
     issued_at timestamptz NOT NULL DEFAULT NOW(),
     observed_at timestamptz,
     action text CHECK (action IS NULL OR action IN ('LIKE', 'PASS')),
     acted_at timestamptz,
     retracted_at timestamptz,
     CHECK (viewer_id <> target_id),
     CHECK (cardinality(feature_codes) <= 50)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_social_discovery_impressions_viewer_issued
     ON social.discovery_impressions (viewer_id, issued_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_social_discovery_impressions_pair
     ON social.discovery_impressions (viewer_id, target_id, issued_at DESC)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS social.discovery_impressions`,
] as const;

export const socialDiscoveryImpressionsMigration: DatabaseMigration = {
  id: "202610130005-social-discovery-impressions",
  description:
    "Records authorized discovery impressions for verified recommendation signals.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

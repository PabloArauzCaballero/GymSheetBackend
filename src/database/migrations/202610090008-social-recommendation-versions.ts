import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.recommendation_profile_versions (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
     updated_at timestamptz NOT NULL DEFAULT NOW()
   )`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS social.recommendation_profile_versions`] as const;

export const socialRecommendationVersionsMigration: DatabaseMigration = {
  id: "202610090008-social-recommendation-versions",
  description: "Tracks monotonic aggregate versions for social recommendation profile events.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

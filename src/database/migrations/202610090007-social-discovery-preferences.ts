import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.discovery_preferences (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     genders text[] NOT NULL CHECK (cardinality(genders) BETWEEN 1 AND 2),
     intents text[] NOT NULL CHECK (cardinality(intents) BETWEEN 1 AND 3),
     min_age smallint NOT NULL CHECK (min_age BETWEEN 18 AND 100),
     max_age smallint NOT NULL CHECK (max_age BETWEEN min_age AND 100),
     radius_km numeric(6,2) NOT NULL CHECK (radius_km BETWEEN 1 AND 500),
     flexible_age boolean NOT NULL,
     flexible_distance boolean NOT NULL,
     version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
     updated_at timestamptz NOT NULL DEFAULT NOW(),
     CONSTRAINT ck_social_discovery_preferences_genders CHECK (genders <@ ARRAY['MALE', 'FEMALE']::text[]),
     CONSTRAINT ck_social_discovery_preferences_intents CHECK (intents <@ ARRAY['TRAINING', 'FRIENDSHIP', 'DATING']::text[])
   )`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS social.discovery_preferences`] as const;

export const socialDiscoveryPreferencesMigration: DatabaseMigration = {
  id: "202610090007-social-discovery-preferences",
  description: "Stores explicit, versioned discovery preferences per user.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

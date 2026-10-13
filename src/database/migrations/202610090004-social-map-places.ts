import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.gym_places (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     kind varchar(8) NOT NULL CHECK (kind IN ('GYM', 'CITY')),
     source varchar(32) NOT NULL CHECK (source = 'OPENSTREETMAP'),
     source_id varchar(64) NOT NULL,
     name varchar(180) NOT NULL,
     address varchar(240),
     city varchar(120),
     region varchar(120),
     latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -85 AND 85),
     longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
     tags jsonb NOT NULL DEFAULT '{}'::jsonb,
     license varchar(32) NOT NULL CHECK (license = 'ODbL-1.0'),
     attribution varchar(160) NOT NULL,
     active boolean NOT NULL DEFAULT TRUE,
     imported_at timestamptz NOT NULL DEFAULT NOW(),
     CONSTRAINT uq_social_gym_places_source UNIQUE (source, source_id, kind)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_social_gym_places_bounds
     ON social.gym_places (kind, active, latitude, longitude)`,
  `CREATE INDEX IF NOT EXISTS ix_social_gym_places_city_search
     ON social.gym_places (kind, lower(name)) WHERE active = TRUE`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS social.gym_places`,
] as const;

export const socialMapPlacesMigration: DatabaseMigration = {
  id: "202610090004-social-map-places",
  description: "Stores imported OSM gym and settlement POIs with source identity and license attribution.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

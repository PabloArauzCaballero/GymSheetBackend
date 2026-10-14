import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.map_locations (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     latitude numeric(9,6) NOT NULL,
     longitude numeric(9,6) NOT NULL,
     cell_id varchar(32) NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT NOW(),
     CONSTRAINT ck_social_map_latitude CHECK (latitude BETWEEN -85 AND 85),
     CONSTRAINT ck_social_map_longitude CHECK (longitude BETWEEN -180 AND 180)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_social_map_locations_cell ON social.map_locations (cell_id)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS social.map_locations`] as const;

export const socialMapLocationsMigration: DatabaseMigration = {
  id: "202610090003-social-map-locations",
  description: "Stores precise social-map locations privately and only indexes approximate consented cells.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

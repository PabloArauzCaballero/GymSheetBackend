import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.gym_place_branch_links (
     source varchar(32) NOT NULL,
     source_id varchar(64) NOT NULL,
     branch_id uuid NOT NULL REFERENCES facilities.branches(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     PRIMARY KEY (source, source_id),
     CONSTRAINT uq_social_gym_place_branch UNIQUE (branch_id)
   )`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS social.gym_place_branch_links`] as const;

export const socialMapPlaceBranchLinksMigration: DatabaseMigration = {
  id: "202610090005-social-map-place-branch-links",
  description: "Links verified external POI identities to registered branches so map clients show one gym marker.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

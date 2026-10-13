import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `ALTER TABLE social.profile_settings
     ADD COLUMN profile_enabled boolean NOT NULL DEFAULT false,
     ADD COLUMN cross_gym_enabled boolean NOT NULL DEFAULT false,
     ADD COLUMN map_enabled boolean NOT NULL DEFAULT false,
     ADD COLUMN map_enabled_since timestamptz,
     ADD COLUMN version integer NOT NULL DEFAULT 0,
     ADD CONSTRAINT ck_profile_settings_cross_gym_requires_profile
       CHECK (NOT cross_gym_enabled OR profile_enabled),
     ADD CONSTRAINT ck_profile_settings_map_requires_profile
       CHECK (NOT map_enabled OR profile_enabled),
     ADD CONSTRAINT ck_profile_settings_version_nonnegative CHECK (version >= 0)`,
] as const;

const downStatements = [
  `ALTER TABLE social.profile_settings
     DROP CONSTRAINT IF EXISTS ck_profile_settings_version_nonnegative,
     DROP CONSTRAINT IF EXISTS ck_profile_settings_map_requires_profile,
     DROP CONSTRAINT IF EXISTS ck_profile_settings_cross_gym_requires_profile,
     DROP COLUMN IF EXISTS version,
     DROP COLUMN IF EXISTS map_enabled,
     DROP COLUMN IF EXISTS map_enabled_since,
     DROP COLUMN IF EXISTS cross_gym_enabled,
     DROP COLUMN IF EXISTS profile_enabled`,
] as const;

export const socialProfileDiscoveryConsentMigration: DatabaseMigration = {
  id: "202610090001-social-profile-discovery-consent",
  description: "Independent opt-in for social, cross-gym and map discovery.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

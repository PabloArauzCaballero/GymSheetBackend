import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

// Frozen snapshot of the interests catalog at the time of this migration.
// A new catalog code ships with a migration that widens this constraint.
const interestCodes = [
  "RUNNING", "CYCLING", "CROSSFIT", "YOGA", "PILATES", "CALISTHENICS", "BOXING",
  "MARTIAL_ARTS", "FOOTBALL", "BASKETBALL", "VOLLEYBALL", "TENNIS", "PADEL",
  "HIKING", "SWIMMING", "POWERLIFTING", "BODYBUILDING", "WEIGHTLIFTING",
  "FUNCTIONAL_TRAINING", "DANCE", "CLIMBING", "SKATING", "SURFING", "TRIATHLON",
  "MOBILITY", "MUSIC", "COOKING", "TRAVEL", "GAMING", "READING", "MOVIES",
  "SERIES", "PHOTOGRAPHY", "PETS", "NUTRITION", "MEDITATION", "ART",
  "TECHNOLOGY", "NATURE", "VOLUNTEERING",
];
const sqlList = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(", ");

const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.profile_details (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     orientation varchar(16) NULL,
     orientation_visible boolean NOT NULL DEFAULT false,
     interests text[] NOT NULL DEFAULT '{}',
     drinking varchar(10) NULL,
     smoking varchar(10) NULL,
     pets varchar(10) NULL,
     bio varchar(500) NULL,
     version integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     updated_at timestamptz NOT NULL DEFAULT NOW(),
     CONSTRAINT ck_social_profile_details_orientation CHECK (orientation IS NULL OR orientation IN (
       'HETEROSEXUAL', 'GAY', 'LESBIAN', 'BISEXUAL', 'ASEXUAL', 'DEMISEXUAL',
       'PANSEXUAL', 'QUEER', 'QUESTIONING')),
     CONSTRAINT ck_social_profile_details_interests_count CHECK (cardinality(interests) <= 5),
     CONSTRAINT ck_social_profile_details_interests_catalog CHECK (
       interests <@ ARRAY[${sqlList(interestCodes)}]::text[]),
     CONSTRAINT ck_social_profile_details_drinking CHECK (drinking IS NULL OR drinking IN ('NEVER', 'SOCIALLY', 'OFTEN')),
     CONSTRAINT ck_social_profile_details_smoking CHECK (smoking IS NULL OR smoking IN ('NEVER', 'SOMETIMES', 'OFTEN')),
     CONSTRAINT ck_social_profile_details_pets CHECK (pets IS NULL OR pets IN ('NONE', 'DOG', 'CAT', 'OTHER', 'WANTS')),
     CONSTRAINT ck_social_profile_details_version CHECK (version >= 1)
   )`,
  // "Aún no lo sé" joins the existing discovery intents.
  `ALTER TABLE social.discovery_preferences
     DROP CONSTRAINT IF EXISTS discovery_preferences_intents_check,
     DROP CONSTRAINT IF EXISTS ck_social_discovery_preferences_intents,
     ADD CONSTRAINT ck_social_discovery_preferences_intents_count CHECK (cardinality(intents) BETWEEN 1 AND 4),
     ADD CONSTRAINT ck_social_discovery_preferences_intents
       CHECK (intents <@ ARRAY['TRAINING', 'FRIENDSHIP', 'DATING', 'UNSURE']::text[])`,
  `ALTER TABLE profile.onboarding
     ADD COLUMN IF NOT EXISTS social_step varchar(16) NOT NULL DEFAULT 'PENDING',
     ADD CONSTRAINT ck_onboarding_social_step CHECK (social_step IN ('PENDING', 'DONE', 'SKIPPED'))`,
] as const;

// Rolling back drops the optional profile answers and removes UNSURE from saved
// preferences; a preference set that only said UNSURE goes back to "not configured".
const downStatements = [
  `ALTER TABLE profile.onboarding
     DROP CONSTRAINT IF EXISTS ck_onboarding_social_step,
     DROP COLUMN IF EXISTS social_step`,
  `UPDATE social.discovery_preferences
      SET intents = array_remove(intents, 'UNSURE')
    WHERE 'UNSURE' = ANY(intents)`,
  `DELETE FROM social.discovery_preferences WHERE cardinality(intents) = 0`,
  `ALTER TABLE social.discovery_preferences
     DROP CONSTRAINT IF EXISTS ck_social_discovery_preferences_intents,
     DROP CONSTRAINT IF EXISTS ck_social_discovery_preferences_intents_count,
     ADD CONSTRAINT discovery_preferences_intents_check CHECK (cardinality(intents) BETWEEN 1 AND 3),
     ADD CONSTRAINT ck_social_discovery_preferences_intents
       CHECK (intents <@ ARRAY['TRAINING', 'FRIENDSHIP', 'DATING']::text[])`,
  `DROP TABLE IF EXISTS social.profile_details`,
] as const;

export const socialProfileDetailsMigration: DatabaseMigration = {
  id: "202611160101-social-profile-details",
  description:
    "Optional Conocer profile answers, UNSURE discovery intent and onboarding social step.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

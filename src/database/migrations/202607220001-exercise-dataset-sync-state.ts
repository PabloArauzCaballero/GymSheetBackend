import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const upStatements = [
  `CREATE TABLE integration.exercise_dataset_sync_state (
     source_key varchar(120) PRIMARY KEY,
     source_url text NOT NULL,
     source_version varchar(80) NOT NULL,
     content_sha256 char(64) NOT NULL,
     fetched_at timestamptz NOT NULL,
     refreshed_at timestamptz NOT NULL,
     record_count integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_exercise_dataset_sync_sha256 CHECK (
       content_sha256 ~ '^[0-9a-f]{64}$'
     ),
     CONSTRAINT ck_exercise_dataset_sync_record_count CHECK (
       record_count BETWEEN 1 AND 5000
     )
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS integration.exercise_dataset_sync_state`,
] as const;

export const exerciseDatasetSyncStateMigration: DatabaseMigration = {
  id: "202607220001-exercise-dataset-sync-state",
  description:
    "Tracks only fully completed external exercise dataset refreshes for daily scheduling.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

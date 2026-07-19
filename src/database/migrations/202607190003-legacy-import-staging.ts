import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE TABLE integration.legacy_import_batches (
     id uuid PRIMARY KEY,
     source_system varchar(120) NOT NULL,
     external_batch_id varchar(180) NOT NULL,
     source_version varchar(120),
     status varchar(40) NOT NULL DEFAULT 'VALIDATING',
     dry_run boolean NOT NULL DEFAULT true,
     total_records integer NOT NULL DEFAULT 0,
     valid_records integer NOT NULL DEFAULT 0,
     invalid_records integer NOT NULL DEFAULT 0,
     imported_records integer NOT NULL DEFAULT 0,
     failed_records integer NOT NULL DEFAULT 0,
     started_at timestamptz NOT NULL DEFAULT now(),
     completed_at timestamptz,
     requested_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_legacy_batch_identity UNIQUE (source_system, external_batch_id),
     CONSTRAINT ck_legacy_batch_status CHECK (status IN (
       'VALIDATING','READY','IMPORTING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED'
     )),
     CONSTRAINT ck_legacy_batch_counts CHECK (
       total_records >= 0 AND valid_records >= 0 AND invalid_records >= 0
       AND imported_records >= 0 AND failed_records >= 0
     )
   )`,
  `CREATE TABLE integration.legacy_import_records (
     id uuid PRIMARY KEY,
     batch_id uuid NOT NULL REFERENCES integration.legacy_import_batches(id) ON DELETE CASCADE,
     source_entity varchar(120) NOT NULL,
     source_record_id varchar(200) NOT NULL,
     payload_fingerprint varchar(64) NOT NULL,
     canonical_payload jsonb NOT NULL,
     status varchar(30) NOT NULL,
     target_entity_type varchar(120),
     target_entity_id uuid,
     error_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
     imported_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_legacy_record_identity UNIQUE (batch_id, source_entity, source_record_id),
     CONSTRAINT ck_legacy_record_status CHECK (status IN ('VALID','INVALID','IMPORTED','SKIPPED','FAILED')),
     CONSTRAINT ck_legacy_fingerprint CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
     CONSTRAINT ck_legacy_payload_object CHECK (jsonb_typeof(canonical_payload) = 'object'),
     CONSTRAINT ck_legacy_errors_array CHECK (jsonb_typeof(error_codes) = 'array')
   )`,
  `CREATE INDEX ix_legacy_records_batch_status
     ON integration.legacy_import_records(batch_id, status, source_entity)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS integration.legacy_import_records`,
  `DROP TABLE IF EXISTS integration.legacy_import_batches`,
] as const;

export const legacyImportStagingMigration: DatabaseMigration = {
  id: '202607190003-legacy-import-staging',
  description: 'Adds canonical, idempotent staging for legacy backend imports.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

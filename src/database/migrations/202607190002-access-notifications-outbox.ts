import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS access_control`,
  `CREATE SCHEMA IF NOT EXISTS notifications`,
  `CREATE SCHEMA IF NOT EXISTS integration`,
  `CREATE TABLE access_control.credentials (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     credential_type varchar(30) NOT NULL,
     provider varchar(100) NOT NULL,
     pin_hash varchar(255),
     external_reference varchar(255),
     status varchar(30) NOT NULL DEFAULT 'ACTIVE',
     consent_version varchar(80),
     consent_recorded_at timestamptz,
     enrolled_at timestamptz NOT NULL DEFAULT now(),
     last_verified_at timestamptz,
     revoked_at timestamptz,
     revocation_reason text,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_credentials_type CHECK (credential_type IN ('PIN','FACE','FINGERPRINT')),
     CONSTRAINT ck_credentials_status CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
     CONSTRAINT ck_credentials_material CHECK (
       (credential_type = 'PIN' AND pin_hash IS NOT NULL AND external_reference IS NULL)
       OR
       (credential_type IN ('FACE','FINGERPRINT') AND pin_hash IS NULL
        AND external_reference IS NOT NULL AND consent_recorded_at IS NOT NULL)
     )
   )`,
  `CREATE UNIQUE INDEX uq_active_pin_credential
     ON access_control.credentials(user_id) WHERE credential_type = 'PIN' AND status = 'ACTIVE'`,
  `CREATE UNIQUE INDEX uq_external_biometric_credential
     ON access_control.credentials(provider, credential_type, external_reference)
     WHERE external_reference IS NOT NULL AND status <> 'REVOKED'`,
  `CREATE INDEX ix_credentials_user_status
     ON access_control.credentials(user_id, status, credential_type)`,
  `CREATE TABLE access_control.devices (
     id uuid PRIMARY KEY,
     access_point_id uuid NOT NULL REFERENCES facilities.access_points(id) ON DELETE RESTRICT,
     adapter_key varchar(100) NOT NULL,
     external_device_id varchar(180) NOT NULL,
     name varchar(180) NOT NULL,
     status varchar(30) NOT NULL DEFAULT 'ACTIVE',
     last_seen_at timestamptz,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_access_device_external UNIQUE (adapter_key, external_device_id),
     CONSTRAINT ck_access_device_status CHECK (status IN ('ACTIVE','MAINTENANCE','OFFLINE','INACTIVE'))
   )`,
  `CREATE TABLE access_control.device_events (
     id uuid PRIMARY KEY,
     device_id uuid NOT NULL REFERENCES access_control.devices(id) ON DELETE RESTRICT,
     source_event_id varchar(200) NOT NULL,
     credential_id uuid NOT NULL REFERENCES access_control.credentials(id) ON DELETE RESTRICT,
     requested_direction varchar(20) NOT NULL,
     occurred_at timestamptz NOT NULL,
     received_at timestamptz NOT NULL DEFAULT now(),
     queue_status varchar(30) NOT NULL DEFAULT 'PENDING',
     attempt_count integer NOT NULL DEFAULT 0,
     available_at timestamptz NOT NULL DEFAULT now(),
     locked_at timestamptz,
     locked_by varchar(160),
     completed_at timestamptz,
     last_error text,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_device_source_event UNIQUE (device_id, source_event_id),
     CONSTRAINT ck_device_event_direction CHECK (requested_direction IN ('ENTRY','EXIT')),
     CONSTRAINT ck_device_event_status CHECK (queue_status IN ('PENDING','PROCESSING','COMPLETED','FAILED','DEAD_LETTER')),
     CONSTRAINT ck_device_event_attempts CHECK (attempt_count >= 0)
   )`,
  `CREATE INDEX ix_device_events_claim
     ON access_control.device_events(queue_status, available_at, received_at)`,
  `CREATE TABLE access_control.decisions (
     id uuid PRIMARY KEY,
     device_event_id uuid NOT NULL UNIQUE REFERENCES access_control.device_events(id) ON DELETE RESTRICT,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     outcome varchar(20) NOT NULL,
     reason_code varchar(60) NOT NULL,
     membership_id uuid REFERENCES membership.memberships(id) ON DELETE SET NULL,
     staff_profile_id uuid REFERENCES membership.staff_profiles(id) ON DELETE SET NULL,
     days_remaining integer,
     decided_at timestamptz NOT NULL DEFAULT now(),
     policy_version varchar(80) NOT NULL,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_access_decision_outcome CHECK (outcome IN ('GRANTED','DENIED')),
     CONSTRAINT ck_access_days_remaining CHECK (days_remaining IS NULL OR days_remaining >= 0)
   )`,
  `CREATE INDEX ix_access_decisions_user_date
     ON access_control.decisions(user_id, decided_at DESC)`,
  `CREATE TABLE notifications.messages (
     id uuid PRIMARY KEY,
     recipient_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     membership_id uuid REFERENCES membership.memberships(id) ON DELETE SET NULL,
     channel varchar(30) NOT NULL,
     subject varchar(240),
     body text NOT NULL,
     days_remaining integer,
     deduplication_key varchar(240) NOT NULL UNIQUE,
     status varchar(30) NOT NULL DEFAULT 'PENDING',
     read_at timestamptz,
     sent_at timestamptz,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_notification_channel CHECK (channel IN ('IN_APP','HTTP_GATEWAY','MOCK')),
     CONSTRAINT ck_notification_status CHECK (status IN ('PENDING','SENT','FAILED','DEAD_LETTER','READ')),
     CONSTRAINT ck_notification_days CHECK (days_remaining IS NULL OR days_remaining >= 0)
   )`,
  `CREATE INDEX ix_notifications_recipient_status
     ON notifications.messages(recipient_user_id, status, created_at DESC)`,
  `CREATE TABLE notifications.delivery_attempts (
     id uuid PRIMARY KEY,
     notification_id uuid NOT NULL REFERENCES notifications.messages(id) ON DELETE CASCADE,
     attempt_number integer NOT NULL,
     provider varchar(100) NOT NULL,
     status varchar(30) NOT NULL,
     provider_message_id varchar(240),
     response_code varchar(80),
     error_code varchar(120),
     attempted_at timestamptz NOT NULL DEFAULT now(),
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_notification_attempt UNIQUE (notification_id, attempt_number),
     CONSTRAINT ck_delivery_attempt_number CHECK (attempt_number > 0),
     CONSTRAINT ck_delivery_attempt_status CHECK (status IN ('SENT','FAILED'))
   )`,
  `CREATE TABLE integration.outbox_jobs (
     id uuid PRIMARY KEY,
     queue_name varchar(120) NOT NULL,
     event_type varchar(160) NOT NULL,
     aggregate_type varchar(120) NOT NULL,
     aggregate_id uuid,
     deduplication_key varchar(240) NOT NULL UNIQUE,
     payload jsonb NOT NULL,
     status varchar(30) NOT NULL DEFAULT 'PENDING',
     attempt_count integer NOT NULL DEFAULT 0,
     max_attempts integer NOT NULL DEFAULT 5,
     available_at timestamptz NOT NULL DEFAULT now(),
     locked_at timestamptz,
     locked_by varchar(160),
     processed_at timestamptz,
     last_error text,
     trace_id varchar(128),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_outbox_status CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','DEAD_LETTER')),
     CONSTRAINT ck_outbox_attempts CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 20),
     CONSTRAINT ck_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object')
   )`,
  `CREATE INDEX ix_outbox_claim
     ON integration.outbox_jobs(queue_name, status, available_at, created_at)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS integration.outbox_jobs`,
  `DROP TABLE IF EXISTS notifications.delivery_attempts`,
  `DROP TABLE IF EXISTS notifications.messages`,
  `DROP TABLE IF EXISTS access_control.decisions`,
  `DROP TABLE IF EXISTS access_control.device_events`,
  `DROP TABLE IF EXISTS access_control.devices`,
  `DROP TABLE IF EXISTS access_control.credentials`,
  `DROP SCHEMA IF EXISTS integration`,
  `DROP SCHEMA IF EXISTS notifications`,
  `DROP SCHEMA IF EXISTS access_control`,
] as const;

export const accessNotificationsOutboxMigration: DatabaseMigration = {
  id: '202607190002-access-notifications-outbox',
  description: 'Adds credentials, access events and decisions, notifications, and transactional outbox.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

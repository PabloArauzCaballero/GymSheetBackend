import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE TABLE integration.domain_events (
     id uuid PRIMARY KEY,
     event_name varchar(160) NOT NULL,
     event_version smallint NOT NULL,
     aggregate_type varchar(120) NOT NULL,
     aggregate_id uuid,
     deduplication_key varchar(240) NOT NULL UNIQUE,
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     correlation_id varchar(128),
     causation_event_id uuid REFERENCES integration.domain_events(id) ON DELETE SET NULL,
     trace_id varchar(128),
     occurred_at timestamptz NOT NULL DEFAULT now(),
     payload jsonb NOT NULL,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_domain_event_version CHECK (event_version > 0),
     CONSTRAINT ck_domain_event_payload_object CHECK (jsonb_typeof(payload) = 'object'),
     CONSTRAINT ck_domain_event_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
   )`,
  `CREATE INDEX ix_domain_events_aggregate
     ON integration.domain_events(aggregate_type, aggregate_id, occurred_at DESC)`,
  `CREATE INDEX ix_domain_events_name_time
     ON integration.domain_events(event_name, occurred_at DESC)`,
  `ALTER TABLE integration.outbox_jobs
     ADD COLUMN domain_event_id uuid REFERENCES integration.domain_events(id) ON DELETE SET NULL`,
  `CREATE INDEX ix_outbox_domain_event
     ON integration.outbox_jobs(domain_event_id)
     WHERE domain_event_id IS NOT NULL`,
  `CREATE TABLE membership.status_history (
     id uuid PRIMARY KEY,
     membership_id uuid NOT NULL REFERENCES membership.memberships(id) ON DELETE CASCADE,
     from_status varchar(30),
     to_status varchar(30) NOT NULL,
     reason text,
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     domain_event_id uuid NOT NULL UNIQUE REFERENCES integration.domain_events(id) ON DELETE RESTRICT,
     occurred_at timestamptz NOT NULL DEFAULT now(),
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_membership_history_from_status CHECK (
       from_status IS NULL OR from_status IN ('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')
     ),
     CONSTRAINT ck_membership_history_to_status CHECK (
       to_status IN ('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')
     ),
     CONSTRAINT ck_membership_history_transition CHECK (
       from_status IS NULL OR from_status <> to_status
     ),
     CONSTRAINT ck_membership_history_metadata_object CHECK (
       jsonb_typeof(metadata) = 'object'
     )
   )`,
  `CREATE INDEX ix_membership_status_history
     ON membership.status_history(membership_id, occurred_at DESC)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS membership.status_history`,
  `DROP INDEX IF EXISTS integration.ix_outbox_domain_event`,
  `ALTER TABLE integration.outbox_jobs DROP COLUMN IF EXISTS domain_event_id`,
  `DROP TABLE IF EXISTS integration.domain_events`,
] as const;

export const domainEventsAndMembershipHistoryMigration: DatabaseMigration = {
  id: '202607190006-domain-events-and-membership-history',
  description:
    'Adds an immutable domain-event ledger, outbox linkage, and membership lifecycle history.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

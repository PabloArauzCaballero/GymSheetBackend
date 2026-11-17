import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Storage of the signup anti-automation layer (ADR-0013).
 *
 * `auth.signup_tickets` is a ledger of SPENT single-use tokens: form tickets
 * and attestation nonces are stateless signed values until used, so issuing
 * them writes nothing and an attacker flooding the issuing endpoints cannot
 * grow the table. The primary key is what makes "single use" hold under
 * concurrency: the second insert of the same id conflicts.
 *
 * `auth.signup_audit` is append-only evidence of every verdict. `user_id` is
 * null for rejections (no account exists) and survives account deletion as
 * null. The raw IP is never stored, only a keyed HMAC that retention nulls
 * after 90 days.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS auth`,
  `CREATE TABLE auth.signup_tickets (
     id uuid PRIMARY KEY,
     kind varchar(20) NOT NULL CHECK (kind IN ('FORM', 'ATTESTATION')),
     issued_at timestamptz NOT NULL,
     used_at timestamptz NOT NULL
   )`,
  // Retention deletes by age; without this it scans the whole ledger.
  `CREATE INDEX ix_auth_signup_tickets_used_at ON auth.signup_tickets(used_at)`,
  `CREATE TABLE auth.signup_audit (
     id uuid PRIMARY KEY,
     user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     ticket_id uuid,
     started_at timestamptz,
     completed_at timestamptz NOT NULL,
     duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
     channel varchar(10) NOT NULL CHECK (channel IN ('WEB', 'IOS', 'ANDROID', 'UNKNOWN')),
     risk varchar(10) NOT NULL CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH')),
     risk_reasons text[] NOT NULL DEFAULT '{}',
     reject_reason varchar(30),
     ip_hmac varchar(64),
     installation_id varchar(64),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // The moderation feed: newest first, optionally by risk. `id` completes the
  // total order keyset pagination needs.
  `CREATE INDEX ix_auth_signup_audit_recent ON auth.signup_audit(created_at DESC, id DESC)`,
  `CREATE INDEX ix_auth_signup_audit_risk ON auth.signup_audit(risk, created_at DESC, id DESC)`,
  `CREATE INDEX ix_auth_signup_audit_user ON auth.signup_audit(user_id) WHERE user_id IS NOT NULL`,
  // Retention nulls old IP hashes; partial so the index shrinks as it works.
  `CREATE INDEX ix_auth_signup_audit_ip_retention ON auth.signup_audit(created_at) WHERE ip_hmac IS NOT NULL`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS auth.signup_audit`,
  `DROP TABLE IF EXISTS auth.signup_tickets`,
] as const;

export const signupAntibotMigration: DatabaseMigration = {
  id: "202611170201-signup-antibot",
  description:
    "Adds the spent-token ledger and the signup verdict audit used by the anti-automation layer.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

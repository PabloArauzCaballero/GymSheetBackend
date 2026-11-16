import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const PERSON_ROLES = `'SYSTEM_ADMIN', 'MODERATOR', 'ADMIN', 'CLIENTE', 'ENTRENADOR_EXTERNO', 'COACH', 'FRONT_DESK'`;
const ENTITY_TYPES = `'GYM', 'COACH', 'CENTER', 'STORE', 'SERVICE_PROVIDER'`;

/**
 * Franja 8a (ADR-0020): business accounts.
 *
 * 1. `usuarios.rol` admits `NEGOCIO`, and a business account cannot hold
 *    person data (birth date, sex).
 * 2. Schema `business` with `business.accounts`: one login per business, 1:1
 *    with a `directory.entities` row that is born `DRAFT` (not public).
 * 3. `directory.entities`: status `CLOSED`; a `DRAFT`/`CLOSED` listing may have
 *    no category or description yet (the signup creates it before step 3).
 * 4. `directory.handles` (the public `@handle` namespace) and the append-only
 *    `directory.handle_changes`.
 * 5. `auth.terms_acceptances.document` admits `BUSINESS_TERMS`, `BUSINESS_DPA`.
 * 6. Plans default to BOB.
 *
 * Rollback: business accounts become closed, inactive `CLIENTE` accounts
 * (they cannot sign in, and keep no person data), their listings are deleted
 * (they are DRAFT: never public, without reviews, plans or orders), the new
 * tables and acceptances of the business documents are dropped and every
 * CHECK and default is restored. `CLOSED` listings fall back to `SUSPENDED`.
 */
const upStatements = [
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN (${PERSON_ROLES}, 'NEGOCIO'))`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_business_no_person_data
     CHECK (rol <> 'NEGOCIO' OR (fecha_nacimiento IS NULL AND genero IS NULL))`,

  `ALTER TABLE directory.entities DROP CONSTRAINT IF EXISTS ck_directory_entity_status`,
  `ALTER TABLE directory.entities
     ADD CONSTRAINT ck_directory_entity_status
     CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'CLOSED'))`,
  `ALTER TABLE directory.entities ALTER COLUMN primary_category_id DROP NOT NULL`,
  `ALTER TABLE directory.entities ALTER COLUMN description SET DEFAULT ''`,
  `ALTER TABLE directory.entities
     ADD CONSTRAINT ck_directory_entity_public_category
     CHECK (status IN ('DRAFT', 'CLOSED') OR primary_category_id IS NOT NULL)`,

  `CREATE SCHEMA IF NOT EXISTS business`,
  `CREATE TABLE business.accounts (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     entity_id uuid NOT NULL UNIQUE REFERENCES directory.entities(id) ON DELETE RESTRICT,
     entity_type varchar(30) NOT NULL CHECK (entity_type IN (${ENTITY_TYPES})),
     legal_kind varchar(12) NOT NULL CHECK (legal_kind IN ('COMPANY', 'INDIVIDUAL')),
     status varchar(12) NOT NULL DEFAULT 'ONBOARDING'
       CHECK (status IN ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
     kyc_status varchar(16) NOT NULL DEFAULT 'DRAFT'
       CHECK (kyc_status IN ('DRAFT', 'SUBMITTED', 'AUTO_APPROVED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
     first_approved_at timestamptz,
     verified_at timestamptz,
     suspended_at timestamptz,
     suspension_reason_code varchar(60),
     closed_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_business_accounts_legal_kind CHECK (
       entity_type = 'SERVICE_PROVIDER'
       OR (entity_type = 'COACH' AND legal_kind = 'INDIVIDUAL')
       OR (entity_type IN ('GYM', 'CENTER', 'STORE') AND legal_kind = 'COMPANY'))
   )`,

  `CREATE TABLE directory.handles (
     handle varchar(30) PRIMARY KEY,
     skeleton varchar(30) NOT NULL,
     owner_entity_id uuid REFERENCES directory.entities(id) ON DELETE CASCADE,
     status varchar(10) NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'RESERVED')),
     redirect_to_handle varchar(30),
     redirect_until timestamptz,
     locked_until timestamptz,
     reserved_reason varchar(200),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_handles_format CHECK (
       handle = lower(handle) AND char_length(handle) BETWEEN 3 AND 30
       AND handle ~ '^[a-z0-9]+([._][a-z0-9]+)*$' AND handle !~ '^[0-9._]+$'),
     CONSTRAINT ck_handles_owner CHECK ((status = 'RESERVED') = (owner_entity_id IS NULL))
   )`,
  // One live holder per skeleton: `top.fitness`, `top_fitness` and `t0pfitness` collide.
  `CREATE UNIQUE INDEX ux_handles_live_skeleton ON directory.handles (skeleton)
     WHERE status IN ('PENDING', 'ACTIVE', 'RESERVED')`,
  // A listing holds at most one current handle.
  `CREATE UNIQUE INDEX ux_handles_entity_current ON directory.handles (owner_entity_id)
     WHERE status IN ('PENDING', 'ACTIVE')`,
  `CREATE INDEX ix_handles_skeleton ON directory.handles (skeleton)`,
  `CREATE TABLE directory.handle_changes (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     entity_id uuid NOT NULL REFERENCES directory.entities(id) ON DELETE CASCADE,
     from_handle varchar(30),
     to_handle varchar(30) NOT NULL,
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     reason varchar(12) NOT NULL CHECK (reason IN ('USER', 'REPP_FORCED')),
     changed_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_handle_changes_entity ON directory.handle_changes (entity_id, changed_at DESC)`,

  `ALTER TABLE auth.terms_acceptances DROP CONSTRAINT IF EXISTS ck_terms_acceptances_document`,
  `ALTER TABLE auth.terms_acceptances
     ADD CONSTRAINT ck_terms_acceptances_document
     CHECK (document IN ('TERMS', 'PRIVACY', 'COMMUNITY', 'BUSINESS_TERMS', 'BUSINESS_DPA'))`,

  `ALTER TABLE directory.entity_plans ALTER COLUMN currency SET DEFAULT 'BOB'`,
] as const;

const downStatements = [
  `ALTER TABLE directory.entity_plans ALTER COLUMN currency SET DEFAULT 'USD'`,

  `DELETE FROM auth.terms_acceptances WHERE document IN ('BUSINESS_TERMS', 'BUSINESS_DPA')`,
  `ALTER TABLE auth.terms_acceptances DROP CONSTRAINT IF EXISTS ck_terms_acceptances_document`,
  `ALTER TABLE auth.terms_acceptances
     ADD CONSTRAINT ck_terms_acceptances_document CHECK (document IN ('TERMS', 'PRIVACY', 'COMMUNITY'))`,

  `DROP TABLE IF EXISTS directory.handle_changes`,
  `DROP TABLE IF EXISTS directory.handles`,

  `UPDATE public.usuarios u
      SET rol = 'CLIENTE', estado = 'INACTIVO',
          closed_at = COALESCE(u.closed_at, now()), sessions_valid_after = now()
    WHERE u.rol = 'NEGOCIO'`,
  `CREATE TEMP TABLE business_entities_to_drop ON COMMIT DROP AS
     SELECT entity_id FROM business.accounts`,
  `DROP TABLE IF EXISTS business.accounts`,
  `DELETE FROM directory.entity_categories WHERE entity_id IN (SELECT entity_id FROM business_entities_to_drop)`,
  `DELETE FROM directory.entities WHERE id IN (SELECT entity_id FROM business_entities_to_drop)`,
  `DROP SCHEMA IF EXISTS business`,

  `ALTER TABLE directory.entities DROP CONSTRAINT IF EXISTS ck_directory_entity_public_category`,
  `ALTER TABLE directory.entities ALTER COLUMN description DROP DEFAULT`,
  `ALTER TABLE directory.entities ALTER COLUMN primary_category_id SET NOT NULL`,
  `UPDATE directory.entities SET status = 'SUSPENDED' WHERE status = 'CLOSED'`,
  `ALTER TABLE directory.entities DROP CONSTRAINT IF EXISTS ck_directory_entity_status`,
  `ALTER TABLE directory.entities
     ADD CONSTRAINT ck_directory_entity_status CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED'))`,

  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_business_no_person_data`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN (${PERSON_ROLES}))`,
] as const;

export const businessAccountsMigration: DatabaseMigration = {
  id: "202611200401-business-accounts",
  description:
    "Business accounts (role NEGOCIO, business.accounts 1:1 with a DRAFT listing), public @handles, business legal documents and BOB as plan currency.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

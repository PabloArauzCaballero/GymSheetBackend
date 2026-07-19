import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS facilities`,
  `CREATE SCHEMA IF NOT EXISTS membership`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (
     rol IN ('ADMIN','CLIENTE','ENTRENADOR_EXTERNO','COACH','FRONT_DESK')
   )`,
  `CREATE TABLE facilities.branches (
     id uuid PRIMARY KEY,
     code varchar(60) NOT NULL UNIQUE,
     name varchar(180) NOT NULL,
     description text,
     time_zone varchar(80) NOT NULL,
     status varchar(20) NOT NULL DEFAULT 'ACTIVE',
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_branches_status CHECK (status IN ('ACTIVE','INACTIVE'))
   )`,
  `CREATE TABLE facilities.rooms (
     id uuid PRIMARY KEY,
     branch_id uuid NOT NULL REFERENCES facilities.branches(id) ON DELETE RESTRICT,
     code varchar(60) NOT NULL,
     name varchar(180) NOT NULL,
     room_type varchar(30) NOT NULL,
     capacity integer,
     status varchar(30) NOT NULL DEFAULT 'ACTIVE',
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_rooms_branch_code UNIQUE (branch_id, code),
     CONSTRAINT ck_rooms_capacity CHECK (capacity IS NULL OR capacity > 0),
     CONSTRAINT ck_rooms_type CHECK (room_type IN (
       'TRAINING','CARDIO','FUNCTIONAL','CLASSROOM','LOCKER','RECEPTION','STAFF','OTHER'
     )),
     CONSTRAINT ck_rooms_status CHECK (status IN ('ACTIVE','MAINTENANCE','CLOSED','INACTIVE'))
   )`,
  `CREATE TABLE facilities.access_points (
     id uuid PRIMARY KEY,
     branch_id uuid NOT NULL REFERENCES facilities.branches(id) ON DELETE RESTRICT,
     room_id uuid REFERENCES facilities.rooms(id) ON DELETE RESTRICT,
     code varchar(80) NOT NULL,
     name varchar(180) NOT NULL,
     allowed_direction varchar(20) NOT NULL DEFAULT 'BOTH',
     status varchar(20) NOT NULL DEFAULT 'ACTIVE',
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_access_points_branch_code UNIQUE (branch_id, code),
     CONSTRAINT ck_access_points_direction CHECK (allowed_direction IN ('ENTRY','EXIT','BOTH')),
     CONSTRAINT ck_access_points_status CHECK (status IN ('ACTIVE','INACTIVE'))
   )`,
  `CREATE TABLE facilities.equipment_assignments (
     id uuid PRIMARY KEY,
     equipment_id uuid NOT NULL REFERENCES public.equipos_gym(id) ON DELETE RESTRICT,
     room_id uuid NOT NULL REFERENCES facilities.rooms(id) ON DELETE RESTRICT,
     assigned_at timestamptz NOT NULL DEFAULT now(),
     ended_at timestamptz,
     notes text,
     assigned_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_equipment_assignment_dates CHECK (ended_at IS NULL OR ended_at >= assigned_at)
   )`,
  `CREATE UNIQUE INDEX uq_active_equipment_assignment
     ON facilities.equipment_assignments(equipment_id) WHERE ended_at IS NULL`,
  `CREATE INDEX ix_equipment_assignments_room_active
     ON facilities.equipment_assignments(room_id, ended_at)`,
  `CREATE TABLE membership.plans (
     id uuid PRIMARY KEY,
     code varchar(80) NOT NULL UNIQUE,
     name varchar(180) NOT NULL,
     description text,
     duration_days integer NOT NULL,
     reminder_days jsonb NOT NULL DEFAULT '[7,3,1,0]'::jsonb,
     status varchar(20) NOT NULL DEFAULT 'ACTIVE',
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_plans_duration CHECK (duration_days > 0 AND duration_days <= 3650),
     CONSTRAINT ck_plans_status CHECK (status IN ('ACTIVE','INACTIVE')),
     CONSTRAINT ck_plans_reminder_days_array CHECK (jsonb_typeof(reminder_days) = 'array')
   )`,
  `CREATE TABLE membership.plan_access_scopes (
     id uuid PRIMARY KEY,
     plan_id uuid NOT NULL REFERENCES membership.plans(id) ON DELETE CASCADE,
     branch_id uuid NOT NULL REFERENCES facilities.branches(id) ON DELETE RESTRICT,
     room_id uuid REFERENCES facilities.rooms(id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_plan_access_scope UNIQUE NULLS NOT DISTINCT (plan_id, branch_id, room_id)
   )`,
  `CREATE TABLE membership.memberships (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     plan_id uuid NOT NULL REFERENCES membership.plans(id) ON DELETE RESTRICT,
     starts_on date NOT NULL,
     ends_on date NOT NULL,
     status varchar(30) NOT NULL DEFAULT 'ACTIVE',
     external_reference varchar(180),
     notes text,
     created_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     cancelled_at timestamptz,
     suspended_at timestamptz,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_memberships_dates CHECK (ends_on >= starts_on),
     CONSTRAINT ck_memberships_status CHECK (status IN ('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
     CONSTRAINT uq_membership_period UNIQUE (user_id, plan_id, starts_on, ends_on)
   )`,
  `CREATE UNIQUE INDEX uq_membership_external_reference
     ON membership.memberships(external_reference) WHERE external_reference IS NOT NULL`,
  `CREATE INDEX ix_memberships_user_status_dates
     ON membership.memberships(user_id, status, starts_on, ends_on)`,
  `CREATE INDEX ix_memberships_expiration_scan
     ON membership.memberships(status, ends_on) WHERE status = 'ACTIVE'`,
  `CREATE TABLE membership.staff_profiles (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL UNIQUE REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     position varchar(40) NOT NULL,
     employment_status varchar(30) NOT NULL DEFAULT 'ACTIVE',
     hired_on date NOT NULL,
     terminated_on date,
     unlimited_access boolean NOT NULL DEFAULT true,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_staff_position CHECK (position IN ('COACH','FRONT_DESK','ADMINISTRATION')),
     CONSTRAINT ck_staff_status CHECK (employment_status IN ('ACTIVE','SUSPENDED','TERMINATED')),
     CONSTRAINT ck_staff_dates CHECK (terminated_on IS NULL OR terminated_on >= hired_on)
   )`,
  `CREATE TABLE membership.staff_branch_scopes (
     id uuid PRIMARY KEY,
     staff_profile_id uuid NOT NULL REFERENCES membership.staff_profiles(id) ON DELETE CASCADE,
     branch_id uuid NOT NULL REFERENCES facilities.branches(id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_staff_branch_scope UNIQUE (staff_profile_id, branch_id)
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS membership.staff_branch_scopes`,
  `DROP TABLE IF EXISTS membership.staff_profiles`,
  `DROP TABLE IF EXISTS membership.memberships`,
  `DROP TABLE IF EXISTS membership.plan_access_scopes`,
  `DROP TABLE IF EXISTS membership.plans`,
  `DROP TABLE IF EXISTS facilities.equipment_assignments`,
  `DROP TABLE IF EXISTS facilities.access_points`,
  `DROP TABLE IF EXISTS facilities.rooms`,
  `DROP TABLE IF EXISTS facilities.branches`,
  `DROP SCHEMA IF EXISTS membership`,
  `DROP SCHEMA IF EXISTS facilities`,
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol`,
  `ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (
     rol IN ('ADMIN','CLIENTE','ENTRENADOR_EXTERNO')
   )`,
] as const;

export const facilitiesMembershipMigration: DatabaseMigration = {
  id: '202607190001-facilities-membership',
  description: 'Adds branches, rooms, equipment assignments, plans, memberships, and staff access.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

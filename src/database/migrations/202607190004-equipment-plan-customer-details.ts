import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

const upStatements = [
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS asset_tag varchar(100)`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS serial_number varchar(180)`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS manufacturer varchar(160)`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS model_name varchar(160)`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS purchased_on date`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS warranty_expires_on date`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS service_interval_days integer`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS next_service_on date`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS out_of_service_reason text`,
  `ALTER TABLE public.equipos_gym ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_asset_tag
     ON public.equipos_gym(asset_tag) WHERE asset_tag IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_serial_number
     ON public.equipos_gym(serial_number) WHERE serial_number IS NOT NULL`,
  `ALTER TABLE public.equipos_gym DROP CONSTRAINT IF EXISTS ck_equipment_service_interval`,
  `ALTER TABLE public.equipos_gym ADD CONSTRAINT ck_equipment_service_interval
     CHECK (service_interval_days IS NULL OR service_interval_days BETWEEN 1 AND 3650)`,
  `ALTER TABLE public.equipos_gym DROP CONSTRAINT IF EXISTS ck_equipment_warranty_dates`,
  `ALTER TABLE public.equipos_gym ADD CONSTRAINT ck_equipment_warranty_dates
     CHECK (warranty_expires_on IS NULL OR purchased_on IS NULL OR warranty_expires_on >= purchased_on)`,
  `CREATE TABLE facilities.maintenance_events (
     id uuid PRIMARY KEY,
     equipment_id uuid NOT NULL REFERENCES public.equipos_gym(id) ON DELETE RESTRICT,
     maintenance_type varchar(30) NOT NULL,
     status varchar(30) NOT NULL DEFAULT 'SCHEDULED',
     scheduled_for date NOT NULL,
     started_at timestamptz,
     completed_at timestamptz,
     vendor_name varchar(180),
     technician_name varchar(180),
     description text NOT NULL,
     findings text,
     resolution text,
     cost_amount numeric(12,2),
     cost_currency char(3),
     created_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_maintenance_type CHECK (maintenance_type IN ('PREVENTIVE','CORRECTIVE','INSPECTION')),
     CONSTRAINT ck_maintenance_status CHECK (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
     CONSTRAINT ck_maintenance_dates CHECK (
       (started_at IS NULL OR started_at::date >= scheduled_for)
       AND (completed_at IS NULL OR started_at IS NOT NULL)
       AND (completed_at IS NULL OR completed_at >= started_at)
     ),
     CONSTRAINT ck_maintenance_cost CHECK (
       (cost_amount IS NULL AND cost_currency IS NULL)
       OR (cost_amount >= 0 AND cost_currency ~ '^[A-Z]{3}$')
     )
   )`,
  `CREATE INDEX ix_maintenance_equipment_status_date
     ON facilities.maintenance_events(equipment_id, status, scheduled_for DESC)`,
  `ALTER TABLE membership.plans ADD COLUMN IF NOT EXISTS plan_type varchar(30) NOT NULL DEFAULT 'CUSTOM'`,
  `ALTER TABLE membership.plans ADD CONSTRAINT ck_plans_type CHECK (
     plan_type IN ('DAY_PASS','WEEKLY','MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL','CUSTOM')
   )`,
  `CREATE TABLE membership.customer_profiles (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL UNIQUE REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     customer_number varchar(80) NOT NULL UNIQUE,
     phone_number varchar(40),
     joined_on date NOT NULL DEFAULT CURRENT_DATE,
     external_reference varchar(180),
     notes text,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX uq_customer_external_reference
     ON membership.customer_profiles(external_reference) WHERE external_reference IS NOT NULL`,
  `CREATE INDEX ix_customer_phone
     ON membership.customer_profiles(phone_number) WHERE phone_number IS NOT NULL`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS membership.customer_profiles`,
  `ALTER TABLE membership.plans DROP CONSTRAINT IF EXISTS ck_plans_type`,
  `ALTER TABLE membership.plans DROP COLUMN IF EXISTS plan_type`,
  `DROP TABLE IF EXISTS facilities.maintenance_events`,
  `ALTER TABLE public.equipos_gym DROP CONSTRAINT IF EXISTS ck_equipment_warranty_dates`,
  `ALTER TABLE public.equipos_gym DROP CONSTRAINT IF EXISTS ck_equipment_service_interval`,
  `DROP INDEX IF EXISTS public.uq_equipment_serial_number`,
  `DROP INDEX IF EXISTS public.uq_equipment_asset_tag`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS metadata`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS out_of_service_reason`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS next_service_on`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS service_interval_days`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS warranty_expires_on`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS purchased_on`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS model_name`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS manufacturer`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS serial_number`,
  `ALTER TABLE public.equipos_gym DROP COLUMN IF EXISTS asset_tag`,
] as const;

export const equipmentPlanCustomerDetailsMigration: DatabaseMigration = {
  id: '202607190004-equipment-plan-customer-details',
  description: 'Adds machine asset lifecycle, plan types, and customer operational profiles.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};

import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Módulo de Marketplace de Planes/Productos de Entes del Directorio,
 * Histórico de Precios con Redundancia Controlada para Auditoría y Protección al Consumidor,
 * Configuración de Cobro Manual con QR Bancario, Órdenes de Pago con Comprobante,
 * y extensión de Community (Comentarios y Valoraciones) para Entidades y Productos.
 */
const upStatements = [
  // 1. Configuración de Pago y QR Bancario de cada Ente del Directorio
  `CREATE TABLE directory.entity_payment_configs (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     entity_id uuid NOT NULL UNIQUE REFERENCES directory.entities(id) ON DELETE CASCADE,
     bank_name varchar(100) NOT NULL,
     account_holder_name varchar(180) NOT NULL,
     tax_id varchar(50) NOT NULL,
     account_number varchar(100) NOT NULL,
     alias_or_phone varchar(100),
     qr_image_url text NOT NULL,
     qr_payload text,
     instructions text,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX ix_entity_payment_configs_entity ON directory.entity_payment_configs(entity_id)`,

  // 2. Planes y Productos que ofrece el Ente en el Marketplace
  `CREATE TABLE directory.entity_plans (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     entity_id uuid NOT NULL REFERENCES directory.entities(id) ON DELETE CASCADE,
     type varchar(30) NOT NULL DEFAULT 'MEMBERSHIP_PLAN',
     name varchar(180) NOT NULL,
     slug varchar(180) NOT NULL,
     description text NOT NULL,
     benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
     duration_days integer,
     current_price numeric(12, 2) NOT NULL,
     currency char(3) NOT NULL DEFAULT 'USD',
     status varchar(20) NOT NULL DEFAULT 'ACTIVE',
     display_order integer NOT NULL DEFAULT 0,
     media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_entity_plan_slug UNIQUE (entity_id, slug),
     CONSTRAINT ck_entity_plan_type CHECK (type IN ('MEMBERSHIP_PLAN', 'PASS', 'SERVICE', 'PRODUCT')),
     CONSTRAINT ck_entity_plan_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
     CONSTRAINT ck_entity_plan_price CHECK (current_price >= 0),
     CONSTRAINT ck_entity_plan_currency CHECK (currency ~ '^[A-Z]{3}$')
   )`,

  `CREATE INDEX ix_entity_plans_entity_status ON directory.entity_plans(entity_id, status, display_order)`,

  // 3. Histórico Inmutable de Precios (Redundancia Controlada por Auditoría y Protección al Consumidor)
  `CREATE TABLE directory.plan_price_history (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     plan_id uuid NOT NULL REFERENCES directory.entity_plans(id) ON DELETE CASCADE,
     price numeric(12, 2) NOT NULL,
     currency char(3) NOT NULL,
     effective_from timestamptz NOT NULL DEFAULT now(),
     effective_to timestamptz,
     changed_by_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     change_reason text NOT NULL,
     is_promotional boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_price_history_positive CHECK (price >= 0),
     CONSTRAINT ck_price_history_currency CHECK (currency ~ '^[A-Z]{3}$'),
     CONSTRAINT ck_price_history_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
   )`,

  `CREATE INDEX ix_plan_price_history_plan ON directory.plan_price_history(plan_id, effective_from DESC)`,

  // 4. Órdenes de Compra y Comprobantes de Pago Manual
  `CREATE TABLE directory.payment_orders (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     order_number varchar(40) NOT NULL UNIQUE,
     entity_id uuid NOT NULL REFERENCES directory.entities(id) ON DELETE RESTRICT,
     plan_id uuid NOT NULL REFERENCES directory.entity_plans(id) ON DELETE RESTRICT,
     athlete_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     price_history_id uuid NOT NULL REFERENCES directory.plan_price_history(id) ON DELETE RESTRICT,
     amount numeric(12, 2) NOT NULL,
     currency char(3) NOT NULL,
     plan_snapshot jsonb NOT NULL,
     status varchar(30) NOT NULL DEFAULT 'PENDING_PAYMENT',
     receipt_url text,
     receipt_storage_key text,
     receipt_reference varchar(100),
     athlete_notes text,
     submitted_at timestamptz,
     verified_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     verified_at timestamptz,
     rejection_reason text,
     membership_id uuid REFERENCES membership.memberships(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_payment_order_status CHECK (
       status IN ('PENDING_PAYMENT', 'PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'CANCELLED')
     ),
     CONSTRAINT ck_payment_order_amount CHECK (amount >= 0)
   )`,

  `CREATE INDEX ix_payment_orders_entity_status ON directory.payment_orders(entity_id, status, created_at DESC)`,
  `CREATE INDEX ix_payment_orders_athlete ON directory.payment_orders(athlete_user_id, created_at DESC)`,

  // 5. Extensión de Community (Valoraciones y Comentarios) para Entidades y Productos
  `ALTER TABLE community.content_ratings ALTER COLUMN target_kind TYPE varchar(30)`,
  `ALTER TABLE community.content_comments ALTER COLUMN target_kind TYPE varchar(30)`,

  `ALTER TABLE community.content_ratings DROP CONSTRAINT IF EXISTS ck_content_rating_kind`,
  `ALTER TABLE community.content_ratings ADD CONSTRAINT ck_content_rating_kind
     CHECK (target_kind IN ('ROUTINE', 'EXERCISE', 'DIRECTORY_ENTITY', 'DIRECTORY_PRODUCT'))`,

  `ALTER TABLE community.content_comments DROP CONSTRAINT IF EXISTS ck_content_comment_kind`,
  `ALTER TABLE community.content_comments ADD CONSTRAINT ck_content_comment_kind
     CHECK (target_kind IN ('ROUTINE', 'EXERCISE', 'DIRECTORY_ENTITY', 'DIRECTORY_PRODUCT'))`,
] as const;

const downStatements = [
  `ALTER TABLE community.content_comments DROP CONSTRAINT IF EXISTS ck_content_comment_kind`,
  `ALTER TABLE community.content_comments ADD CONSTRAINT ck_content_comment_kind
     CHECK (target_kind IN ('ROUTINE', 'EXERCISE'))`,

  `ALTER TABLE community.content_ratings DROP CONSTRAINT IF EXISTS ck_content_rating_kind`,
  `ALTER TABLE community.content_ratings ADD CONSTRAINT ck_content_rating_kind
     CHECK (target_kind IN ('ROUTINE', 'EXERCISE'))`,

  `DROP TABLE IF EXISTS directory.payment_orders`,
  `DROP TABLE IF EXISTS directory.plan_price_history`,
  `DROP TABLE IF EXISTS directory.entity_plans`,
  `DROP TABLE IF EXISTS directory.entity_payment_configs`,
] as const;

export const directoryMarketplaceAndPaymentsMigration: DatabaseMigration = {
  id: '202610190002-directory-marketplace-and-payments',
  description:
    'Marketplace de planes/productos de entes del directorio con histórico auditable de precios, cobros QR y comprobantes manuales, y extensión de comentarios de comunidad.',
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

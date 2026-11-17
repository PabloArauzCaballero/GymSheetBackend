import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const OFFER_KINDS = `'MEMBERSHIP', 'DAY_PASS', 'MULTI_DAY_PASS', 'CLASS_PACK', 'PRODUCT', 'SERVICE_SESSION', 'SERVICE_PACK'`;
const PREVIOUS_TARGET_KINDS = `'STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER','ROUTINE','EXERCISE','COMMENT','REEL','MUSIC_PLAYLIST'`;
const PREVIOUS_RESOLUTIONS = `'SIN_ACCION', 'CONTENIDO_OCULTO', 'USUARIO_ADVERTIDO', 'USUARIO_SUSPENDIDO', 'USUARIO_EXPULSADO', 'MENOR_CONFIRMADO'`;
/** The kind a legacy row gets from its `type` (same rule as `legacyOfferKind` in the application). */
const OFFER_KIND_OF_TYPE = `CASE type
     WHEN 'MEMBERSHIP_PLAN' THEN 'MEMBERSHIP'
     WHEN 'PASS' THEN CASE WHEN duration_days > 1 THEN 'MULTI_DAY_PASS' ELSE 'DAY_PASS' END
     WHEN 'SERVICE' THEN 'SERVICE_SESSION'
     ELSE 'PRODUCT' END`;
const PUBLIC_LISTING = `moderation_status = 'LIVE' AND status = 'ACTIVE'`;

/**
 * Franja 8c (ADR-0022): business listings with post-moderation, locations and
 * public search.
 *
 * 1. `directory.entity_plans` (a "listing" in the API) gains `offer_kind`
 *    (backfilled from `type`, which stays derived from it and checked),
 *    `sessions_count`, stock, `product_category_id` and the moderation state
 *    (`LIVE|HELD|HIDDEN|REJECTED`, born `HELD`: nothing is public until the
 *    publication checks pass). The validity of a listing is the existing
 *    `duration_days` column: no second column for the same fact. A trigger fills
 *    `offer_kind` from `type` for a writer that does not send it (expand phase).
 * 2. A legacy row is backfilled `LIVE` only if it would pass today's shape and
 *    currency rules; otherwise it is `HELD` with the failing codes, visible
 *    to its owner. The per-kind validity and the BOB-only currency are CHECKs
 *    on every `LIVE` row, so a non-conforming listing can never be public.
 * 3. `directory.entity_locations` (a listing's declared locations), with the
 *    legacy branch linked by `legacy_branch_id` and backfilled from
 *    `entities.branch_id`.
 * 4. Search indexes: trigram over the normalized name and keyset indexes for
 *    the public sorts, all partial on public listings; entity type/city.
 * 5. `moderation.reports` accepts `BUSINESS_LISTING` and `BUSINESS_PROFILE`,
 *    and the resolution `NEGOCIO_SUSPENDIDO`.
 *
 * Rollback: the reports and resolution CHECKs are restored `NOT VALID` (a
 * report about a listing stays as history; deleting moderation evidence is
 * worse than an unvalidated old row), the locations table and every new
 * column, constraint and index are dropped. `type` was kept derived, so the
 * listings stay readable by the previous code. A listing that is not LIVE
 * (held, hidden or rejected) becomes `INACTIVE` first: the old code does not
 * know the moderation state, and a rollback must never publish what REPP or
 * the checks kept off the marketplace.
 */
const upStatements = [
  `ALTER TABLE directory.entity_plans
     ADD COLUMN offer_kind varchar(20),
     ADD COLUMN sessions_count integer,
     ADD COLUMN stock_quantity integer,
     ADD COLUMN stock_reserved integer NOT NULL DEFAULT 0,
     ADD COLUMN product_category_id uuid REFERENCES directory.categories(id) ON DELETE SET NULL,
     ADD COLUMN moderation_status varchar(10) NOT NULL DEFAULT 'HELD',
     ADD COLUMN moderation_reason_code varchar(40),
     ADD COLUMN auto_check_codes text[] NOT NULL DEFAULT '{}',
     ADD COLUMN published_at timestamptz,
     ADD COLUMN moderated_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     ADD COLUMN moderated_at timestamptz`,
  `UPDATE directory.entity_plans SET offer_kind = ${OFFER_KIND_OF_TYPE}`,
  // Legacy rows: the codes today's checks would raise; LIVE only without any.
  `UPDATE directory.entity_plans SET auto_check_codes = array_remove(ARRAY[
       CASE WHEN currency <> 'BOB' THEN 'CURRENCY_NOT_BOB' END,
       CASE WHEN offer_kind = 'MEMBERSHIP' AND duration_days IS NULL THEN 'VALIDITY_REQUIRED' END,
       CASE WHEN offer_kind = 'PRODUCT' AND duration_days IS NOT NULL THEN 'VALIDITY_NOT_ALLOWED' END
     ]::text[], NULL)`,
  `UPDATE directory.entity_plans
      SET moderation_status = CASE WHEN cardinality(auto_check_codes) = 0 THEN 'LIVE' ELSE 'HELD' END,
          moderation_reason_code = auto_check_codes[1],
          published_at = CASE WHEN cardinality(auto_check_codes) = 0 THEN created_at END`,
  // Expand phase: a writer that only knows `type` (the previous release during a rolling deploy, raw
  // seeds) still inserts; its row gets the kind the backfill would give and is born HELD.
  `CREATE OR REPLACE FUNCTION directory.entity_plans_default_offer_kind() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.offer_kind IS NULL THEN
         NEW.offer_kind := ${OFFER_KIND_OF_TYPE.replace(/\btype\b/g, "NEW.type").replace(/\bduration_days\b/g, "NEW.duration_days")};
       END IF;
       RETURN NEW;
     END $$`,
  `CREATE TRIGGER trg_entity_plans_default_offer_kind BEFORE INSERT ON directory.entity_plans
     FOR EACH ROW EXECUTE FUNCTION directory.entity_plans_default_offer_kind()`,
  `ALTER TABLE directory.entity_plans
     ALTER COLUMN offer_kind SET NOT NULL,
     ADD CONSTRAINT ck_entity_plan_offer_kind CHECK (offer_kind IN (${OFFER_KINDS})),
     ADD CONSTRAINT ck_entity_plan_type_of_kind CHECK (type = CASE offer_kind
       WHEN 'MEMBERSHIP' THEN 'MEMBERSHIP_PLAN'
       WHEN 'PRODUCT' THEN 'PRODUCT'
       WHEN 'SERVICE_SESSION' THEN 'SERVICE'
       WHEN 'SERVICE_PACK' THEN 'SERVICE'
       ELSE 'PASS' END),
     ADD CONSTRAINT ck_entity_plan_sessions CHECK (
       (offer_kind IN ('CLASS_PACK', 'SERVICE_PACK')) = (sessions_count IS NOT NULL) AND (sessions_count IS NULL OR sessions_count BETWEEN 1 AND 1000)),
     ADD CONSTRAINT ck_entity_plan_stock CHECK (
       stock_reserved >= 0 AND (stock_quantity IS NULL OR (stock_quantity >= 0 AND stock_reserved <= stock_quantity))
       AND (offer_kind = 'PRODUCT' OR (stock_quantity IS NULL AND stock_reserved = 0))),
     ADD CONSTRAINT ck_entity_plan_product_category CHECK (offer_kind = 'PRODUCT' OR product_category_id IS NULL),
     ADD CONSTRAINT ck_entity_plan_moderation_status CHECK (moderation_status IN ('LIVE', 'HELD', 'HIDDEN', 'REJECTED')),
     ADD CONSTRAINT ck_entity_plan_live_published CHECK (moderation_status <> 'LIVE' OR published_at IS NOT NULL),
     ADD CONSTRAINT ck_entity_plan_live_currency CHECK (moderation_status <> 'LIVE' OR currency = 'BOB'),
     ADD CONSTRAINT ck_entity_plan_live_validity CHECK (moderation_status <> 'LIVE' OR CASE offer_kind
       WHEN 'MEMBERSHIP' THEN duration_days IS NOT NULL
       WHEN 'MULTI_DAY_PASS' THEN duration_days >= 2
       WHEN 'DAY_PASS' THEN duration_days IS NULL OR duration_days = 1
       WHEN 'PRODUCT' THEN duration_days IS NULL
       ELSE true END)`,

  // Public search: trigram over the normalized name, keyset sorts, filters.
  `CREATE INDEX ix_entity_plans_public_name_trgm ON directory.entity_plans
     USING gin (public.repp_normalize(name) public.gin_trgm_ops) WHERE ${PUBLIC_LISTING}`,
  `CREATE INDEX ix_entity_plans_public_recent ON directory.entity_plans (published_at DESC, id DESC) WHERE ${PUBLIC_LISTING}`,
  `CREATE INDEX ix_entity_plans_public_price ON directory.entity_plans (current_price, id) WHERE ${PUBLIC_LISTING}`,
  `CREATE INDEX ix_entity_plans_kind_moderation_price ON directory.entity_plans (offer_kind, moderation_status, current_price)`,
  // The business's own panel (newest first) and REPP's held queue (oldest first).
  `CREATE INDEX ix_entity_plans_entity_created ON directory.entity_plans (entity_id, created_at DESC, id DESC)`,
  `CREATE INDEX ix_entity_plans_held ON directory.entity_plans (updated_at, id) WHERE moderation_status = 'HELD'`,
  `CREATE INDEX ix_directory_entities_type_status_city ON directory.entities (entity_type, status, city)`,

  `CREATE TABLE directory.entity_locations (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     entity_id uuid NOT NULL REFERENCES directory.entities(id) ON DELETE CASCADE,
     name varchar(120) NOT NULL CHECK (char_length(btrim(name)) >= 2),
     address varchar(500),
     city varchar(100),
     latitude numeric(9, 6),
     longitude numeric(9, 6),
     business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
     display_order integer NOT NULL DEFAULT 0,
     legacy_branch_id uuid REFERENCES facilities.branches(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_entity_locations_coordinates CHECK ((latitude IS NULL) = (longitude IS NULL)
       AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)))
   )`,
  `CREATE UNIQUE INDEX ux_entity_locations_name ON directory.entity_locations (entity_id, lower(name))`,
  `CREATE UNIQUE INDEX ux_entity_locations_legacy_branch ON directory.entity_locations (entity_id, legacy_branch_id)
     WHERE legacy_branch_id IS NOT NULL`,
  `CREATE INDEX ix_entity_locations_entity ON directory.entity_locations (entity_id, display_order, id)`,
  `INSERT INTO directory.entity_locations (entity_id, name, address, city, latitude, longitude, legacy_branch_id)
   SELECT e.id, left(b.name, 120), b.address, e.city, b.latitude, b.longitude, b.id
     FROM directory.entities e JOIN facilities.branches b ON b.id = e.branch_id`,

  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN (${PREVIOUS_TARGET_KINDS},'BUSINESS_LISTING','BUSINESS_PROFILE'))`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_resolution`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_resolution
     CHECK (resolution IS NULL OR resolution IN (${PREVIOUS_RESOLUTIONS}, 'NEGOCIO_SUSPENDIDO'))`,
] as const;

const downStatements = [
  `UPDATE directory.entity_plans SET status = 'INACTIVE', updated_at = now() WHERE moderation_status <> 'LIVE' AND status = 'ACTIVE'`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_resolution`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_resolution
     CHECK (resolution IS NULL OR resolution IN (${PREVIOUS_RESOLUTIONS})) NOT VALID`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN (${PREVIOUS_TARGET_KINDS})) NOT VALID`,
  `DROP TABLE IF EXISTS directory.entity_locations`,
  `DROP INDEX IF EXISTS directory.ix_directory_entities_type_status_city`,
  `DROP INDEX IF EXISTS directory.ix_entity_plans_held`,
  `DROP INDEX IF EXISTS directory.ix_entity_plans_entity_created`,
  `DROP INDEX IF EXISTS directory.ix_entity_plans_kind_moderation_price`,
  `DROP INDEX IF EXISTS directory.ix_entity_plans_public_price`,
  `DROP INDEX IF EXISTS directory.ix_entity_plans_public_recent`,
  `DROP INDEX IF EXISTS directory.ix_entity_plans_public_name_trgm`,
  `DROP TRIGGER IF EXISTS trg_entity_plans_default_offer_kind ON directory.entity_plans`,
  `DROP FUNCTION IF EXISTS directory.entity_plans_default_offer_kind()`,
  // Constraints go with their columns.
  `ALTER TABLE directory.entity_plans
     DROP COLUMN IF EXISTS moderated_at,
     DROP COLUMN IF EXISTS moderated_by_user_id,
     DROP COLUMN IF EXISTS published_at,
     DROP COLUMN IF EXISTS auto_check_codes,
     DROP COLUMN IF EXISTS moderation_reason_code,
     DROP COLUMN IF EXISTS moderation_status,
     DROP COLUMN IF EXISTS product_category_id,
     DROP COLUMN IF EXISTS stock_reserved,
     DROP COLUMN IF EXISTS stock_quantity,
     DROP COLUMN IF EXISTS sessions_count,
     DROP COLUMN IF EXISTS offer_kind`,
] as const;

export const businessListingsMigration: DatabaseMigration = {
  id: "202611200601-business-listings",
  description:
    "Business listings (ADR-0022): offer kinds, stock and post-moderation state on entity_plans, entity locations, public search indexes and the BUSINESS_LISTING/BUSINESS_PROFILE report kinds.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

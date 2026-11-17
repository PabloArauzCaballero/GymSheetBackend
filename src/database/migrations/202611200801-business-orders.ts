import { QueryTypes } from "sequelize";
import { env } from "../../config/env";
import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const PREVIOUS_ORDER_STATUSES = `'PENDING_PAYMENT', 'PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'CANCELLED'`;
const PREVIOUS_TARGET_KINDS = `'STORY','PROFILE_PHOTO','CHAT_MESSAGE','USER','ROUTINE','EXERCISE','COMMENT','REEL','MUSIC_PLAYLIST','BUSINESS_LISTING','BUSINESS_PROFILE'`;
const OPEN = `('PENDING_PAYMENT', 'PENDING_VERIFICATION')`;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Franja 8d (ADR-0024): orders paid by the business's QR (or in cash) and
 * confirmed by the business. REPP never touches the money.
 *
 * 1. `directory.payment_orders` gains the quantity and unit amount (the total
 *    is checked to be their product), the method `QR|CASH`, the payment
 *    deadline, cancellation, the private encrypted receipt
 *    (`orders/{orderId}/receipt/{uuid}.bin`, its type and SHA-256 of the
 *    plaintext), how many receipts were sent, the stock units the order holds
 *    reserved, the rejection code, who decided and when, and how many
 *    verification reminders went out. `EXPIRED` joins the statuses.
 *    `receipt_url` and `verified_*` stay for legacy rows (contracted in 8f);
 *    `decided_*` is backfilled from them.
 * 2. `directory.payment_order_history`, append-only: every status change,
 *    with its actor (null for the system) and reason. Backfilled with one row
 *    per existing order.
 * 3. `directory.entity_payment_configs` gains the private encrypted QR
 *    (`business/{entityId}/payment/{uuid}.bin`), cash acceptance and the
 *    holder-name match; the tax id, account number and public QR URL become
 *    optional (the NIT lives in the KYC, the QR is a private file).
 * 4. `moderation.reports` accepts `PAYMENT_ORDER` (a buyer's dispute).
 *
 * `stock_reserved <= stock_quantity` is already guaranteed by
 * `ck_entity_plan_stock` (8c); nothing to add there.
 *
 * Rollback: every private receipt and QR file is queued on `media.release`;
 * the units open orders hold are returned to their listings (the previous
 * code does not release reservations); `EXPIRED` becomes `CANCELLED`; who
 * decided is copied to `verified_*`; the tax id, account number and QR URL
 * get an empty value where missing so their NOT NULL can come back; the
 * reports CHECK is restored `NOT VALID` (a dispute stays as history); the
 * history table and the new columns go.
 */
const upStatements = [
  `ALTER TABLE directory.payment_orders
     ADD COLUMN quantity integer NOT NULL DEFAULT 1,
     ADD COLUMN unit_amount numeric(12, 2),
     ADD COLUMN method varchar(4) NOT NULL DEFAULT 'QR',
     ADD COLUMN expires_at timestamptz,
     ADD COLUMN cancelled_at timestamptz,
     ADD COLUMN cancel_reason varchar(24),
     ADD COLUMN receipt_private_key text,
     ADD COLUMN receipt_mime varchar(20),
     ADD COLUMN receipt_sha256 char(64),
     ADD COLUMN receipt_attempts smallint NOT NULL DEFAULT 0,
     ADD COLUMN stock_reserved_units integer NOT NULL DEFAULT 0,
     ADD COLUMN rejection_code varchar(16),
     ADD COLUMN decided_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     ADD COLUMN decided_at timestamptz,
     ADD COLUMN reminders_sent smallint NOT NULL DEFAULT 0`,
  `UPDATE directory.payment_orders
      SET unit_amount = amount,
          decided_by_user_id = verified_by_user_id,
          decided_at = verified_at,
          receipt_attempts = CASE WHEN submitted_at IS NULL THEN 0 ELSE 1 END,
          expires_at = CASE WHEN status = 'PENDING_PAYMENT' THEN created_at + interval '24 hours' END`,
  `ALTER TABLE directory.payment_orders ALTER COLUMN unit_amount SET NOT NULL`,
  `ALTER TABLE directory.payment_orders DROP CONSTRAINT IF EXISTS ck_payment_order_status`,
  `ALTER TABLE directory.payment_orders
     ADD CONSTRAINT ck_payment_order_status CHECK (status IN (${PREVIOUS_ORDER_STATUSES}, 'EXPIRED')),
     ADD CONSTRAINT ck_payment_order_quantity CHECK (quantity BETWEEN 1 AND 1000),
     ADD CONSTRAINT ck_payment_order_total CHECK (unit_amount >= 0 AND amount = unit_amount * quantity),
     ADD CONSTRAINT ck_payment_order_method CHECK (method IN ('QR', 'CASH')),
     ADD CONSTRAINT ck_payment_order_payment_deadline CHECK (status <> 'PENDING_PAYMENT' OR expires_at IS NOT NULL),
     ADD CONSTRAINT ck_payment_order_cancel CHECK (
       (cancel_reason IS NULL OR cancel_reason IN ('BUYER', 'BUSINESS_UNAVAILABLE', 'EXPIRED'))
       AND (cancel_reason IS NULL) = (cancelled_at IS NULL)),
     ADD CONSTRAINT ck_payment_order_rejection_code CHECK (
       rejection_code IS NULL OR rejection_code IN ('AMOUNT_MISMATCH', 'UNREADABLE', 'NOT_RECEIVED', 'OTHER')),
     ADD CONSTRAINT ck_payment_order_receipt CHECK (
       (receipt_private_key IS NULL) = (receipt_sha256 IS NULL) AND (receipt_private_key IS NULL) = (receipt_mime IS NULL)
       AND (receipt_private_key IS NULL OR receipt_private_key ~ ('^orders/' || id::text || '/receipt/${UUID}\\.bin$'))
       AND (receipt_sha256 IS NULL OR receipt_sha256 ~ '^[0-9a-f]{64}$')
       AND (method = 'QR' OR receipt_private_key IS NULL)),
     ADD CONSTRAINT ck_payment_order_counters CHECK (
       receipt_attempts BETWEEN 0 AND 10 AND reminders_sent BETWEEN 0 AND 2
       AND stock_reserved_units >= 0 AND stock_reserved_units <= quantity)`,
  `CREATE INDEX ix_payment_orders_open_deadline ON directory.payment_orders (expires_at)
     WHERE status IN ${OPEN} AND expires_at IS NOT NULL`,
  `CREATE INDEX ix_payment_orders_verification ON directory.payment_orders (submitted_at)
     WHERE status = 'PENDING_VERIFICATION' AND method = 'QR'`,
  `CREATE INDEX ix_payment_orders_athlete_open ON directory.payment_orders (athlete_user_id, plan_id)
     WHERE status IN ${OPEN}`,

  `CREATE TABLE directory.payment_order_history (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     order_id uuid NOT NULL REFERENCES directory.payment_orders(id) ON DELETE CASCADE,
     from_status varchar(30),
     to_status varchar(30) NOT NULL,
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     reason_code varchar(24),
     at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_payment_order_history_order ON directory.payment_order_history (order_id, at, id)`,
  `INSERT INTO directory.payment_order_history (order_id, from_status, to_status, actor_user_id, at)
   SELECT id, NULL, status, NULL, created_at FROM directory.payment_orders`,

  `ALTER TABLE directory.entity_payment_configs
     ADD COLUMN qr_private_key text,
     ADD COLUMN qr_mime varchar(20),
     ADD COLUMN accepts_cash boolean NOT NULL DEFAULT false,
     ADD COLUMN holder_match varchar(7),
     ADD COLUMN holder_similarity numeric(4, 3),
     ALTER COLUMN tax_id DROP NOT NULL,
     ALTER COLUMN account_number DROP NOT NULL,
     ALTER COLUMN qr_image_url DROP NOT NULL`,
  `ALTER TABLE directory.entity_payment_configs
     ADD CONSTRAINT ck_payment_config_qr CHECK (
       (qr_private_key IS NULL) = (qr_mime IS NULL)
       AND (qr_private_key IS NULL OR qr_private_key ~ ('^business/' || entity_id::text || '/payment/${UUID}\\.bin$'))),
     ADD CONSTRAINT ck_payment_config_holder_match CHECK (
       (holder_match IS NULL OR holder_match IN ('PASS', 'WARN', 'UNKNOWN'))
       AND (holder_similarity IS NULL OR holder_similarity BETWEEN 0 AND 1))`,

  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN (${PREVIOUS_TARGET_KINDS},'PAYMENT_ORDER'))`,
] as const;

const downStatements = [
  `UPDATE directory.entity_plans p
      SET stock_reserved = GREATEST(p.stock_reserved - held.units, 0), updated_at = now()
     FROM (SELECT plan_id, sum(stock_reserved_units)::int AS units FROM directory.payment_orders
            WHERE status IN ${OPEN} AND stock_reserved_units > 0 GROUP BY plan_id) held
    WHERE p.id = held.plan_id`,
  `UPDATE directory.payment_orders SET status = 'CANCELLED', updated_at = now() WHERE status = 'EXPIRED'`,
  `UPDATE directory.payment_orders
      SET verified_by_user_id = decided_by_user_id, verified_at = decided_at
    WHERE verified_at IS NULL AND decided_at IS NOT NULL`,
  `ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS ck_moderation_report_target_kind`,
  `ALTER TABLE moderation.reports ADD CONSTRAINT ck_moderation_report_target_kind
     CHECK (target_kind IN (${PREVIOUS_TARGET_KINDS})) NOT VALID`,
  `DROP TABLE IF EXISTS directory.payment_order_history`,
  `DROP INDEX IF EXISTS directory.ix_payment_orders_athlete_open`,
  `DROP INDEX IF EXISTS directory.ix_payment_orders_verification`,
  `DROP INDEX IF EXISTS directory.ix_payment_orders_open_deadline`,
  `ALTER TABLE directory.payment_orders DROP CONSTRAINT IF EXISTS ck_payment_order_status`,
  // Constraints on the new columns go with them.
  `ALTER TABLE directory.payment_orders
     DROP COLUMN IF EXISTS reminders_sent,
     DROP COLUMN IF EXISTS decided_at,
     DROP COLUMN IF EXISTS decided_by_user_id,
     DROP COLUMN IF EXISTS rejection_code,
     DROP COLUMN IF EXISTS stock_reserved_units,
     DROP COLUMN IF EXISTS receipt_attempts,
     DROP COLUMN IF EXISTS receipt_sha256,
     DROP COLUMN IF EXISTS receipt_mime,
     DROP COLUMN IF EXISTS receipt_private_key,
     DROP COLUMN IF EXISTS cancel_reason,
     DROP COLUMN IF EXISTS cancelled_at,
     DROP COLUMN IF EXISTS expires_at,
     DROP COLUMN IF EXISTS method,
     DROP COLUMN IF EXISTS unit_amount,
     DROP COLUMN IF EXISTS quantity`,
  `ALTER TABLE directory.payment_orders ADD CONSTRAINT ck_payment_order_status CHECK (status IN (${PREVIOUS_ORDER_STATUSES}))`,
  `UPDATE directory.entity_payment_configs
      SET tax_id = COALESCE(tax_id, ''), account_number = COALESCE(account_number, ''), qr_image_url = COALESCE(qr_image_url, '')
    WHERE tax_id IS NULL OR account_number IS NULL OR qr_image_url IS NULL`,
  `ALTER TABLE directory.entity_payment_configs
     DROP COLUMN IF EXISTS holder_similarity,
     DROP COLUMN IF EXISTS holder_match,
     DROP COLUMN IF EXISTS accepts_cash,
     DROP COLUMN IF EXISTS qr_mime,
     DROP COLUMN IF EXISTS qr_private_key,
     ALTER COLUMN tax_id SET NOT NULL,
     ALTER COLUMN account_number SET NOT NULL,
     ALTER COLUMN qr_image_url SET NOT NULL`,
] as const;

/** Every private payment file still stored, to be deleted for real before its column goes. */
const PRIVATE_FILES_SQL = `
  SELECT 'directory.payment_order' AS "aggregateType", id::text AS id, receipt_private_key AS key
    FROM directory.payment_orders WHERE receipt_private_key IS NOT NULL
  UNION ALL
  SELECT 'directory.payment_config', entity_id::text, qr_private_key
    FROM directory.entity_payment_configs WHERE qr_private_key IS NOT NULL`;

export const businessOrdersMigration: DatabaseMigration = {
  id: "202611200801-business-orders",
  description:
    "Business orders (ADR-0024): quantity, method QR|CASH, payment deadline, private encrypted receipt, stock reservation, decision and EXPIRED on payment_orders; append-only order history; private QR and cash on payment configs; PAYMENT_ORDER reports.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: async (queryInterface, transaction) => {
    const files = await queryInterface.sequelize.query<{ aggregateType: string; id: string; key: string }>(PRIVATE_FILES_SQL, {
      type: QueryTypes.SELECT,
      transaction,
    });
    for (const file of files) {
      await queryInterface.sequelize.query(
        `INSERT INTO integration.outbox_jobs
           (id, queue_name, event_type, aggregate_type, aggregate_id, deduplication_key, payload, status,
            attempt_count, max_attempts, available_at, created_at, updated_at)
         VALUES (uuid_generate_v4(), 'media.release', 'media.file-release-requested.v1', :aggregateType, CAST(:id AS uuid),
                 :dedup, CAST(:payload AS jsonb), 'PENDING', 0, 8, now(), now(), now())
         ON CONFLICT DO NOTHING`,
        {
          replacements: {
            aggregateType: file.aggregateType,
            id: file.id,
            dedup: `media-release:${file.aggregateType}:${file.id}:${file.key}`,
            payload: JSON.stringify({ schemaVersion: 1, provider: env.MEDIA_STORAGE_PROVIDER, storageKey: file.key }),
          },
          transaction,
        },
      );
    }
    await executeSqlStatements(queryInterface, transaction, downStatements);
  },
};

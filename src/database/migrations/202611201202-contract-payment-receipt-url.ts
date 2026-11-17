import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Franja 8f (ADR-0028), contraction announced by ADR-0024:
 * `directory.payment_orders.receipt_url` (the public receipt URL of the
 * orders before 8d) has no reader left in the backend or the frontend; the
 * receipt is the private, encrypted `receipt_private_key`.
 *
 * The values of legacy rows move to `retired.payment_order_receipt_urls`
 * (same pattern as ADR-0026), so the rollback restores them; the final DROP
 * of that table belongs to a later franja.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS retired`,
  `CREATE TABLE retired.payment_order_receipt_urls (
     order_id uuid PRIMARY KEY REFERENCES directory.payment_orders(id) ON DELETE CASCADE,
     receipt_url text NOT NULL,
     retired_at timestamptz NOT NULL DEFAULT now())`,
  `INSERT INTO retired.payment_order_receipt_urls (order_id, receipt_url)
   SELECT id, receipt_url FROM directory.payment_orders WHERE receipt_url IS NOT NULL`,
  `ALTER TABLE directory.payment_orders DROP COLUMN receipt_url`,
] as const;

const downStatements = [
  `ALTER TABLE directory.payment_orders ADD COLUMN IF NOT EXISTS receipt_url text`,
  `UPDATE directory.payment_orders o SET receipt_url = r.receipt_url
     FROM retired.payment_order_receipt_urls r WHERE r.order_id = o.id`,
  `DROP TABLE IF EXISTS retired.payment_order_receipt_urls`,
] as const;

export const contractPaymentReceiptUrlMigration: DatabaseMigration = {
  id: "202611201202-contract-payment-receipt-url",
  description: "Contraction (ADR-0024/0028): payment_orders.receipt_url dropped; legacy values kept in retired.payment_order_receipt_urls.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

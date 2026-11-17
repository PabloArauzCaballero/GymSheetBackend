import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const ORDER_CANCEL_REASONS = `'BUYER', 'BUSINESS_UNAVAILABLE', 'EXPIRED'`;
const AFFILIATION_REASONS = `'UNKNOWN_PERSON', 'CI_MISMATCH', 'WRONG_LOCATION', 'NOT_A_COACH_HERE', 'NO_LONGER_MEMBER', 'NO_LONGER_COACH',
  'CONDUCT', 'OTHER', 'WITHDRAWN', 'LEFT', 'SWITCHED_GYM', 'ACCOUNT_CLOSED'`;
const HMAC_ARRAY = (column: string) => `array_to_string(${column}, ',') ~ '^([0-9a-f]{64}(,[0-9a-f]{64})*)?$'`;

const orderCancelCheck = (reasons: string) => `ALTER TABLE directory.payment_orders ADD CONSTRAINT ck_payment_order_cancel
  CHECK ((cancel_reason IS NULL OR cancel_reason IN (${reasons})) AND ((cancel_reason IS NULL) = (cancelled_at IS NULL)))`;
const affiliationReasonCheck = (reasons: string) => `ALTER TABLE directory.affiliations ADD CONSTRAINT ck_affiliations_reason
  CHECK ((reason_code IS NULL OR reason_code IN (${reasons}))
     AND (status IN ('REQUESTED', 'CONFIRMED') OR reason_code IS NOT NULL)
     AND (reason_note IS NULL OR reason_code IS NOT NULL))`;

/**
 * Franja 8f (ADR-0028): a business account closes itself.
 *
 * 1. `BUSINESS_CLOSED` joins the cancel reasons of an order (an unpaid order
 *    of a closing business) and the closing reasons of an affiliation (the gym
 *    or the coach business that closed).
 * 2. `moderation.closed_account_sanctions` carries a business: the HMACs of
 *    the NITs and CIs of its KYC (the same fingerprints of ADR-0021), and
 *    whether REPP had it suspended. Such a record may hold no strike and no
 *    timed suspension. Inheriting by email at a new signup marks it
 *    `consumed_at` instead of deleting it, so the NIT and CI keep counting
 *    for the KYC check `CLOSED_ACCOUNT_SANCTION` until the record expires.
 *
 * Rollback: the new reasons fall back to the nearest old ones
 * (`BUSINESS_UNAVAILABLE`, `ACCOUNT_CLOSED`); the records only a business
 * produced and the consumed ones are deleted (the previous code would apply
 * a consumed record again), then the columns and checks go back.
 */
const upStatements = [
  `ALTER TABLE directory.payment_orders DROP CONSTRAINT ck_payment_order_cancel`,
  orderCancelCheck(`${ORDER_CANCEL_REASONS}, 'BUSINESS_CLOSED'`),
  `ALTER TABLE directory.affiliations DROP CONSTRAINT ck_affiliations_reason`,
  affiliationReasonCheck(`${AFFILIATION_REASONS}, 'BUSINESS_CLOSED'`),
  `ALTER TABLE moderation.closed_account_sanctions
     ADD COLUMN nit_hmacs varchar(64)[] NOT NULL DEFAULT '{}',
     ADD COLUMN ci_hmacs varchar(64)[] NOT NULL DEFAULT '{}',
     ADD COLUMN business_suspended boolean NOT NULL DEFAULT false,
     ADD COLUMN consumed_at timestamptz NULL`,
  `ALTER TABLE moderation.closed_account_sanctions DROP CONSTRAINT ck_closed_account_sanctions_not_empty`,
  `ALTER TABLE moderation.closed_account_sanctions ADD CONSTRAINT ck_closed_account_sanctions_not_empty
     CHECK (strike_count > 0 OR suspended_until IS NOT NULL OR business_suspended)`,
  `ALTER TABLE moderation.closed_account_sanctions ADD CONSTRAINT ck_closed_account_sanctions_business_hmacs
     CHECK (${HMAC_ARRAY("nit_hmacs")} AND ${HMAC_ARRAY("ci_hmacs")})`,
  // The KYC probe: `:hmac = ANY(nit_hmacs)` on a small table, served by GIN.
  `CREATE INDEX ix_closed_account_sanctions_nit ON moderation.closed_account_sanctions USING gin (nit_hmacs)`,
  `CREATE INDEX ix_closed_account_sanctions_ci ON moderation.closed_account_sanctions USING gin (ci_hmacs)`,
] as const;

const downStatements = [
  `UPDATE directory.payment_orders SET cancel_reason = 'BUSINESS_UNAVAILABLE' WHERE cancel_reason = 'BUSINESS_CLOSED'`,
  `UPDATE directory.payment_order_history SET reason_code = 'BUSINESS_UNAVAILABLE' WHERE reason_code = 'BUSINESS_CLOSED'`,
  `ALTER TABLE directory.payment_orders DROP CONSTRAINT ck_payment_order_cancel`,
  orderCancelCheck(ORDER_CANCEL_REASONS),
  // The history trigger fires on status changes only: rewriting the reason leaves the history as it is.
  `UPDATE directory.affiliations SET reason_code = 'ACCOUNT_CLOSED' WHERE reason_code = 'BUSINESS_CLOSED'`,
  `UPDATE directory.affiliation_history SET reason_code = 'ACCOUNT_CLOSED' WHERE reason_code = 'BUSINESS_CLOSED'`,
  `ALTER TABLE directory.affiliations DROP CONSTRAINT ck_affiliations_reason`,
  affiliationReasonCheck(AFFILIATION_REASONS),
  `DELETE FROM moderation.closed_account_sanctions WHERE consumed_at IS NOT NULL OR (strike_count = 0 AND suspended_until IS NULL)`,
  `DROP INDEX IF EXISTS moderation.ix_closed_account_sanctions_nit`,
  `DROP INDEX IF EXISTS moderation.ix_closed_account_sanctions_ci`,
  `ALTER TABLE moderation.closed_account_sanctions DROP CONSTRAINT ck_closed_account_sanctions_business_hmacs`,
  `ALTER TABLE moderation.closed_account_sanctions DROP CONSTRAINT ck_closed_account_sanctions_not_empty`,
  `ALTER TABLE moderation.closed_account_sanctions
     DROP COLUMN nit_hmacs, DROP COLUMN ci_hmacs, DROP COLUMN business_suspended, DROP COLUMN consumed_at`,
  `ALTER TABLE moderation.closed_account_sanctions ADD CONSTRAINT ck_closed_account_sanctions_not_empty
     CHECK (strike_count > 0 OR suspended_until IS NOT NULL)`,
] as const;

export const businessClosureMigration: DatabaseMigration = {
  id: "202611201201-business-closure",
  description:
    "Business closure (ADR-0028): BUSINESS_CLOSED order cancel and affiliation reasons; closed-account sanctions carry the NIT and CI HMACs and the REPP suspension of a business.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

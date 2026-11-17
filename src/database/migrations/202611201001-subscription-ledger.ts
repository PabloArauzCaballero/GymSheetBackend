import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/** Offer kinds a period can come from: everything a listing sells except a product (ADR-0022). */
const PERIOD_KINDS = `'MEMBERSHIP', 'DAY_PASS', 'MULTI_DAY_PASS', 'CLASS_PACK', 'SERVICE_SESSION', 'SERVICE_PACK'`;
/** Kinds that may have no end date: a pack or a session without validity lasts until it is used. */
const OPEN_ENDED_KINDS = `'CLASS_PACK', 'SERVICE_SESSION', 'SERVICE_PACK'`;

/**
 * Franja 8e-1 (ADR-0026), expand: `membership.memberships` becomes the ledger
 * of subscription periods sold on the marketplace. One confirmed order = one
 * period, never an extension in place.
 *
 * New columns: the seller (`entity_id`), the listing (`entity_plan_id`), the
 * order that paid it (`payment_order_id`, unique), the SOCIO affiliation it
 * goes with (`affiliation_id`), `offer_kind`, a snapshot of the name sold
 * (`plan_name`), `sessions_total`/`sessions_used` and `origin`
 * MARKETPLACE|LEGACY. `plan_id` (the old global catalogue) becomes optional,
 * and so does `ends_on` for a pack or a session without validity.
 *
 * Composite foreign keys make the database hold that the listing is the
 * seller's and that the affiliation is of this person at this gym.
 *
 * Backfill (no row is lost or rewritten beyond its new columns):
 * - a membership created by the 8d bridge (an order points at it through
 *   `payment_orders.membership_id`, or its metadata names the order) becomes
 *   MARKETPLACE with the seller, listing and kind of that order;
 * - every other row is LEGACY: kind DAY_PASS when its plan was one, MEMBERSHIP
 *   otherwise; `plan_name` from its plan; `entity_id` is the GYM entity whose
 *   `tenant_id` is the holder's tenant when exactly one exists (informative:
 *   a legacy row is never shown to a business).
 *
 * Rollback: a period without a plan (sold after 8e) gets an inactive mirror
 * plan `dir8e_<listing>` like the 8d bridge used, and an open-ended one an end
 * date one year after its start; what the old columns cannot hold (kind,
 * name, sessions, affiliation, a legacy row's gym, «no end date») is stashed in
 * `metadata.ledger`, which a new `up` restores. Then the columns and
 * constraints go and `plan_id`/`ends_on` are required again. Every row
 * survives the round trip.
 */
const upStatements = [
  `CREATE UNIQUE INDEX ux_entity_plans_id_entity ON directory.entity_plans (id, entity_id)`,
  `CREATE UNIQUE INDEX ux_affiliations_id_user_gym ON directory.affiliations (id, user_id, gym_entity_id)`,
  `ALTER TABLE membership.memberships
     ADD COLUMN entity_id uuid REFERENCES directory.entities(id) ON DELETE RESTRICT,
     ADD COLUMN entity_plan_id uuid,
     ADD COLUMN payment_order_id uuid REFERENCES directory.payment_orders(id) ON DELETE RESTRICT,
     ADD COLUMN affiliation_id uuid,
     ADD COLUMN offer_kind varchar(20),
     ADD COLUMN plan_name varchar(180),
     ADD COLUMN sessions_total integer,
     ADD COLUMN sessions_used integer NOT NULL DEFAULT 0,
     ADD COLUMN origin varchar(12) NOT NULL DEFAULT 'LEGACY',
     ALTER COLUMN plan_id DROP NOT NULL,
     ALTER COLUMN ends_on DROP NOT NULL`,

  // Periods sold through the 8d bridge: one order per membership.
  `WITH bridged AS (
     SELECT DISTINCT ON (m.id) m.id AS membership_id, o.id AS order_id, o.entity_id, o.plan_id, ep.offer_kind, ep.name
       FROM membership.memberships m
       JOIN directory.payment_orders o ON o.membership_id = m.id OR m.metadata->>'paymentOrderId' = o.id::text
       JOIN directory.entity_plans ep ON ep.id = o.plan_id
      ORDER BY m.id, (o.membership_id = m.id) DESC, o.created_at)
   UPDATE membership.memberships m
      SET payment_order_id = b.order_id, entity_id = b.entity_id, entity_plan_id = b.plan_id,
          offer_kind = CASE WHEN b.offer_kind = 'PRODUCT' THEN 'MEMBERSHIP' ELSE b.offer_kind END,
          plan_name = b.name, origin = 'MARKETPLACE'
     FROM bridged b WHERE b.membership_id = m.id`,
  // Legacy rows: their plan names them; the gym is the holder's tenant's only GYM entity, if any.
  `UPDATE membership.memberships m
      SET plan_name = p.name, offer_kind = CASE WHEN p.plan_type = 'DAY_PASS' THEN 'DAY_PASS' ELSE 'MEMBERSHIP' END
     FROM membership.plans p WHERE p.id = m.plan_id AND m.origin = 'LEGACY'`,
  `WITH gyms AS (
     SELECT tenant_id, (array_agg(id))[1] AS entity_id FROM directory.entities
      WHERE entity_type = 'GYM' AND tenant_id IS NOT NULL GROUP BY tenant_id HAVING count(*) = 1)
   UPDATE membership.memberships m SET entity_id = g.entity_id
     FROM public.usuarios u JOIN gyms g ON g.tenant_id = u.tenant_id
    WHERE u.id = m.user_id AND m.origin = 'LEGACY'`,
  // A row a previous down stashed gets back exactly what it had (kind, name, sessions, affiliation, no end date).
  `UPDATE membership.memberships m
      SET offer_kind = COALESCE(m.metadata->'ledger'->>'offerKind', m.offer_kind),
          plan_name = COALESCE(m.metadata->'ledger'->>'planName', m.plan_name),
          sessions_total = (m.metadata->'ledger'->>'sessionsTotal')::integer,
          sessions_used = COALESCE((m.metadata->'ledger'->>'sessionsUsed')::integer, 0),
          affiliation_id = (SELECT a.id FROM directory.affiliations a
                             WHERE a.id::text = m.metadata->'ledger'->>'affiliationId' AND a.user_id = m.user_id AND a.gym_entity_id = m.entity_id),
          ends_on = CASE WHEN (m.metadata->'ledger'->>'openEnded')::boolean THEN NULL ELSE m.ends_on END,
          entity_id = CASE WHEN m.origin = 'LEGACY' THEN (m.metadata->'ledger'->>'entityId')::uuid ELSE m.entity_id END,
          metadata = m.metadata - 'ledger'
    WHERE m.metadata ? 'ledger'`,

  `ALTER TABLE membership.memberships
     ALTER COLUMN offer_kind SET NOT NULL,
     ALTER COLUMN plan_name SET NOT NULL,
     ADD CONSTRAINT fk_memberships_entity_plan FOREIGN KEY (entity_plan_id, entity_id)
       REFERENCES directory.entity_plans (id, entity_id) ON DELETE RESTRICT,
     ADD CONSTRAINT fk_memberships_affiliation FOREIGN KEY (affiliation_id, user_id, entity_id)
       REFERENCES directory.affiliations (id, user_id, gym_entity_id) ON DELETE SET NULL (affiliation_id),
     ADD CONSTRAINT uq_memberships_payment_order UNIQUE (payment_order_id),
     ADD CONSTRAINT ck_memberships_origin CHECK (
       origin IN ('MARKETPLACE', 'LEGACY')
       AND (origin = 'MARKETPLACE') = (payment_order_id IS NOT NULL)
       AND (origin = 'LEGACY' OR (entity_id IS NOT NULL AND entity_plan_id IS NOT NULL))
       AND (origin = 'MARKETPLACE' OR plan_id IS NOT NULL)),
     ADD CONSTRAINT ck_memberships_offer_kind CHECK (offer_kind IN (${PERIOD_KINDS})),
     ADD CONSTRAINT ck_memberships_open_ended CHECK (ends_on IS NOT NULL OR offer_kind IN (${OPEN_ENDED_KINDS})),
     ADD CONSTRAINT ck_memberships_sessions CHECK (
       sessions_used >= 0 AND (sessions_total IS NULL OR (sessions_total > 0 AND sessions_used <= sessions_total))
       AND (sessions_total IS NOT NULL OR sessions_used = 0))`,
  // The chain: the latest ACTIVE period of a person for a listing.
  `CREATE INDEX ix_memberships_chain ON membership.memberships (user_id, entity_plan_id, ends_on DESC)
     WHERE status = 'ACTIVE' AND entity_plan_id IS NOT NULL`,
  // The business's subscribers, soonest to expire first.
  `CREATE INDEX ix_memberships_seller ON membership.memberships (entity_id, ends_on, id) WHERE origin = 'MARKETPLACE'`,
] as const;

const downStatements = [
  `INSERT INTO membership.plans (id, code, name, description, duration_days, status, plan_type, price_amount, currency, benefits, metadata)
   SELECT DISTINCT ON (ep.id) uuid_generate_v4(), 'dir8e_' || ep.id, left(ep.name, 180), ep.description,
          LEAST(GREATEST(COALESCE(ep.duration_days, 1), 1), 3650), 'INACTIVE', 'CUSTOM', ep.current_price, ep.currency,
          COALESCE(ep.benefits, '[]'::jsonb), jsonb_build_object('directoryPlanId', ep.id, 'entityId', ep.entity_id, 'rollback', '202611201001')
     FROM membership.memberships m JOIN directory.entity_plans ep ON ep.id = m.entity_plan_id
    WHERE m.plan_id IS NULL
   ON CONFLICT (code) DO NOTHING`,
  `UPDATE membership.memberships m
      SET plan_id = p.id, metadata = m.metadata || jsonb_build_object('paymentOrderId', m.payment_order_id)
     FROM membership.plans p
    WHERE m.plan_id IS NULL AND p.code = 'dir8e_' || m.entity_plan_id`,
  // What the old columns cannot hold waits in the metadata for a new up.
  `UPDATE membership.memberships
      SET metadata = metadata || jsonb_build_object('ledger', jsonb_build_object(
            'offerKind', offer_kind, 'planName', plan_name, 'sessionsTotal', sessions_total, 'sessionsUsed', sessions_used,
            'affiliationId', affiliation_id, 'entityId', entity_id, 'openEnded', ends_on IS NULL)),
          ends_on = COALESCE(ends_on, starts_on + 364)`,
  `DROP INDEX IF EXISTS membership.ix_memberships_seller`,
  `DROP INDEX IF EXISTS membership.ix_memberships_chain`,
  `ALTER TABLE membership.memberships
     DROP CONSTRAINT IF EXISTS ck_memberships_sessions,
     DROP CONSTRAINT IF EXISTS ck_memberships_open_ended,
     DROP CONSTRAINT IF EXISTS ck_memberships_offer_kind,
     DROP CONSTRAINT IF EXISTS ck_memberships_origin,
     DROP CONSTRAINT IF EXISTS uq_memberships_payment_order,
     DROP CONSTRAINT IF EXISTS fk_memberships_affiliation,
     DROP CONSTRAINT IF EXISTS fk_memberships_entity_plan,
     DROP COLUMN origin, DROP COLUMN sessions_used, DROP COLUMN sessions_total, DROP COLUMN plan_name,
     DROP COLUMN offer_kind, DROP COLUMN affiliation_id, DROP COLUMN payment_order_id,
     DROP COLUMN entity_plan_id, DROP COLUMN entity_id,
     ALTER COLUMN plan_id SET NOT NULL,
     ALTER COLUMN ends_on SET NOT NULL`,
  `DROP INDEX IF EXISTS directory.ux_affiliations_id_user_gym`,
  `DROP INDEX IF EXISTS directory.ux_entity_plans_id_entity`,
] as const;

export const subscriptionLedgerMigration: DatabaseMigration = {
  id: "202611201001-subscription-ledger",
  description:
    "Subscription ledger (ADR-0026): memberships gain seller, listing, paying order (unique), SOCIO affiliation, offer kind, name snapshot, sessions and origin MARKETPLACE|LEGACY; plan_id and ends_on become optional; legacy rows are backfilled.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};

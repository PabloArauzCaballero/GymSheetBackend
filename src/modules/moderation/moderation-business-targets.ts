/**
 * SQL of the marketplace report targets (ADR-0022), kept out of the moderation
 * repository so each query reads next to the others of its kind. Every
 * statement binds `:targetId`; table and column names are constants.
 */

/**
 * Who answers for a reported listing or profile: the business account that
 * owns it. Only what is public can be reported, so a held, hidden, paused or
 * suspended one answers 404 and the report endpoint never confirms that a
 * non-public listing exists.
 */
export const BUSINESS_TARGET_OWNER_SQL = {
  BUSINESS_LISTING: `SELECT e.user_id AS "userId", u.tenant_id AS "tenantId"
                       FROM directory.entity_plans p
                       JOIN directory.entities e ON e.id = p.entity_id
                       JOIN public.usuarios u ON u.id = e.user_id
                      WHERE p.id = :targetId AND p.moderation_status = 'LIVE' AND p.status = 'ACTIVE' AND e.status = 'ACTIVE'`,
  BUSINESS_PROFILE: `SELECT e.user_id AS "userId", u.tenant_id AS "tenantId"
                       FROM directory.entities e
                       JOIN public.usuarios u ON u.id = e.user_id
                      WHERE e.id = :targetId AND e.status = 'ACTIVE'`,
  // Only the buyer disputes an order, and only once money may have moved (a receipt or a cash order).
  PAYMENT_ORDER: `SELECT e.user_id AS "userId", u.tenant_id AS "tenantId"
                    FROM directory.payment_orders o
                    JOIN directory.entities e ON e.id = o.entity_id
                    JOIN public.usuarios u ON u.id = e.user_id
                   WHERE o.id = :targetId AND o.athlete_user_id = :reporterId AND o.status <> 'PENDING_PAYMENT'`,
} as const;

/** Whether the case's content is already off the marketplace: a hidden listing, a suspended business. */
export const BUSINESS_TARGET_HIDDEN_SQL = {
  BUSINESS_LISTING: `SELECT (moderation_status = 'HIDDEN') AS hidden FROM directory.entity_plans WHERE id = :targetId`,
  BUSINESS_PROFILE: `SELECT (status = 'SUSPENDED') AS hidden FROM directory.entities WHERE id = :targetId`,
  PAYMENT_ORDER: `SELECT (e.status = 'SUSPENDED') AS hidden FROM directory.payment_orders o
                    JOIN directory.entities e ON e.id = o.entity_id WHERE o.id = :targetId`,
} as const;

/** The business (entity) a case is about, to suspend it. */
export const BUSINESS_TARGET_ENTITY_SQL = {
  BUSINESS_LISTING: `SELECT entity_id AS "entityId" FROM directory.entity_plans WHERE id = :targetId`,
  BUSINESS_PROFILE: `SELECT id AS "entityId" FROM directory.entities WHERE id = :targetId`,
  PAYMENT_ORDER: `SELECT entity_id AS "entityId" FROM directory.payment_orders WHERE id = :targetId`,
} as const;

export type BusinessTargetKind = keyof typeof BUSINESS_TARGET_ENTITY_SQL;

export function isBusinessTargetKind(kind: string): kind is BusinessTargetKind {
  return Object.prototype.hasOwnProperty.call(BUSINESS_TARGET_ENTITY_SQL, kind);
}

/**
 * Hides a listing (LIVE or HELD → HIDDEN) or restores one (HIDDEN → LIVE);
 * any other state is left alone, so dismissing a case never publishes a
 * listing the checks held or REPP rejected.
 */
export function listingVisibilitySql(hidden: boolean): string {
  return hidden
    ? `UPDATE directory.entity_plans
          SET moderation_status = 'HIDDEN', moderation_reason_code = :reason,
              moderated_by_user_id = :moderatorUserId, moderated_at = now(), updated_at = now()
        WHERE id = :targetId AND moderation_status IN ('LIVE', 'HELD')`
    : `UPDATE directory.entity_plans
          SET moderation_status = 'LIVE', moderation_reason_code = NULL, published_at = COALESCE(published_at, now()),
              moderated_by_user_id = :moderatorUserId, moderated_at = now(), updated_at = now()
        WHERE id = :targetId AND moderation_status = 'HIDDEN'`;
}

/** Queue joins: whether each card's listing is hidden or its business suspended. */
export const BUSINESS_QUEUE_JOINS = `
         LEFT JOIN directory.entity_plans bl
           ON r.target_kind = 'BUSINESS_LISTING' AND bl.id = r.target_id
         LEFT JOIN directory.entities bp
           ON r.target_kind = 'BUSINESS_PROFILE' AND bp.id = r.target_id
         LEFT JOIN directory.payment_orders bo
           ON r.target_kind = 'PAYMENT_ORDER' AND bo.id = r.target_id
         LEFT JOIN directory.entities boe ON boe.id = bo.entity_id`;
export const BUSINESS_QUEUE_HIDDEN = `bool_or(bl.moderation_status = 'HIDDEN') OR bool_or(bp.status = 'SUSPENDED') OR bool_or(boe.status = 'SUSPENDED')`;

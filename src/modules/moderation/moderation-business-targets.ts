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
} as const;

/** Whether the case's content is already off the marketplace: a hidden listing, a suspended business. */
export const BUSINESS_TARGET_HIDDEN_SQL = {
  BUSINESS_LISTING: `SELECT (moderation_status = 'HIDDEN') AS hidden FROM directory.entity_plans WHERE id = :targetId`,
  BUSINESS_PROFILE: `SELECT (status = 'SUSPENDED') AS hidden FROM directory.entities WHERE id = :targetId`,
} as const;

/** The business (entity) a case is about, to suspend it. */
export const BUSINESS_TARGET_ENTITY_SQL = {
  BUSINESS_LISTING: `SELECT entity_id AS "entityId" FROM directory.entity_plans WHERE id = :targetId`,
  BUSINESS_PROFILE: `SELECT id AS "entityId" FROM directory.entities WHERE id = :targetId`,
} as const;

/**
 * Hides a listing (LIVE or HELD → HIDDEN) or restores one: HIDDEN → LIVE only
 * when its stored check codes are clean, else HELD (it was held when hidden).
 * Any other state is left alone, so dismissing a case never publishes a
 * listing the checks held or REPP rejected.
 */
export function listingVisibilitySql(hidden: boolean): string {
  return hidden
    ? `UPDATE directory.entity_plans
          SET moderation_status = 'HIDDEN', moderation_reason_code = :reason,
              moderated_by_user_id = :moderatorUserId, moderated_at = now(), updated_at = now()
        WHERE id = :targetId AND moderation_status IN ('LIVE', 'HELD')`
    : `UPDATE directory.entity_plans
          SET moderation_status = CASE WHEN cardinality(auto_check_codes) = 0 THEN 'LIVE' ELSE 'HELD' END,
              moderation_reason_code = auto_check_codes[1],
              published_at = CASE WHEN cardinality(auto_check_codes) = 0 THEN COALESCE(published_at, now()) ELSE published_at END,
              moderated_by_user_id = :moderatorUserId, moderated_at = now(), updated_at = now()
        WHERE id = :targetId AND moderation_status = 'HIDDEN'`;
}

/** Queue joins: whether each card's listing is hidden or its business suspended. */
export const BUSINESS_QUEUE_JOINS = `
         LEFT JOIN directory.entity_plans bl
           ON r.target_kind = 'BUSINESS_LISTING' AND bl.id = r.target_id
         LEFT JOIN directory.entities bp
           ON r.target_kind = 'BUSINESS_PROFILE' AND bp.id = r.target_id`;
export const BUSINESS_QUEUE_HIDDEN = `bool_or(bl.moderation_status = 'HIDDEN') OR bool_or(bp.status = 'SUSPENDED')`;

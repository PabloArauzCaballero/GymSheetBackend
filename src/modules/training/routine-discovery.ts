/**
 * Which published routines a viewer may *discover* in a list. Both lists that
 * show community routines use it, so web and mobile answer the same:
 * the cursor catalog (`public`, `official`, `all` tabs, «Para ti») and the
 * legacy page list of mobile «Explorar rutinas» (`scope=public|templates&page`).
 *
 * - Reports: a routine the viewer reported, in any report status (open,
 *   resolved or dismissed), stays hidden from that viewer until they withdraw
 *   the report (`withdrawn_at`, `me/reports/:id/withdraw`). Others still see it.
 * - Blocks: mutual; nothing by an author who blocked the viewer or whom the
 *   viewer blocked.
 * - Tenant scope: official REPP routines (`es_oficial`, or legacy TEMPLATE
 *   visibility) are platform-wide. A community routine from another gym is
 *   listed only when its author may be shown outside their gym under the same
 *   rule as the social directory and reels: an active, non-suspended adult who
 *   opened profile discovery and cross-gym discovery. The card exposes the
 *   author's name and photo, so the routine follows the person's consent.
 *   Otherwise it is listed only to the author's gym: `tenant_id_autor`, falling
 *   back to the author's account and then to DEFAULT_TENANT_ID, exactly like the
 *   session resolves the viewer's gym (also what «De mi gimnasio» filters by).
 *
 * Opening a routine by id is unchanged (`canViewRoutine`): a link someone was
 * given still works; this only decides what is surfaced in lists. The catalog
 * cursor is an offset, so reporting or blocking while paging can shift the
 * remaining results and skip one card; the next refresh is exact.
 *
 * `r` is the routines table alias, already quoted if needed. Bound parameters:
 * `:viewerId`, `:viewerTenantId`, `:defaultTenantId` (never interpolated values).
 * Each subquery is an index lookup: reports by
 * `ix_moderation_reports_reporter_target`, blocks by their PK /
 * (blocked_id, blocker_id), users, settings and profiles by PK.
 */

/** The gym a routine belongs to, with the same fallbacks the session uses. */
export function routineAuthorTenantSql(r: string): string {
  return `COALESCE(${r}.tenant_id_autor,
                  (SELECT au.tenant_id FROM public.usuarios au WHERE au.id = ${r}.created_by_user_id),
                  :defaultTenantId)`;
}

/** Same eligibility as the cross-gym branch of the social directory (social.repository.ts). */
export function crossGymDiscoverableUserSql(userId: string): string {
  return `EXISTS (SELECT 1 FROM public.usuarios cu
                   JOIN social.profile_settings ps ON ps.user_id = cu.id
                   LEFT JOIN public.perfiles_antropometricos cp ON cp.usuario_id = cu.id
                  WHERE cu.id = ${userId}
                    AND cu.estado = 'ACTIVO'
                    AND (cu.suspended_until IS NULL OR cu.suspended_until <= NOW())
                    AND ps.profile_enabled AND ps.cross_gym_enabled
                    AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, cp.fecha_nacimiento))::int, cp.edad, 0) >= 18)`;
}

/** Never what the viewer reported, nor anything by an author in a block relation with the viewer. */
export function routineNotHiddenByViewerSql(r: string): string {
  return `NOT EXISTS (
      SELECT 1 FROM moderation.reports rep
       WHERE rep.reporter_user_id = :viewerId AND rep.target_kind = 'ROUTINE' AND rep.target_id = ${r}.id
         AND rep.withdrawn_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM social.user_blocks blk
       WHERE (blk.blocker_id = :viewerId AND blk.blocked_id = ${r}.created_by_user_id)
          OR (blk.blocker_id = ${r}.created_by_user_id AND blk.blocked_id = :viewerId))`;
}

/** Official, own, same gym, or an author who may be discovered across gyms. */
export function routineWithinViewerReachSql(r: string): string {
  return `(${r}.es_oficial = true OR ${r}.visibilidad = 'TEMPLATE' OR ${r}.created_by_user_id = :viewerId
      OR ${routineAuthorTenantSql(r)} = :viewerTenantId
      OR ${crossGymDiscoverableUserSql(`${r}.created_by_user_id`)})`;
}

export function routineDiscoverableSql(r: string): string {
  return `(${routineNotHiddenByViewerSql(r)} AND ${routineWithinViewerReachSql(r)})`;
}

export type DiscoveryViewer = { id: string; tenantId: string };

export function discoveryReplacements(viewer: DiscoveryViewer, defaultTenantId: string | undefined) {
  return { viewerId: viewer.id, viewerTenantId: viewer.tenantId, defaultTenantId: defaultTenantId ?? null };
}

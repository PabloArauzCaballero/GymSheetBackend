/** Report states in which moderation has not decided yet. */
export const OPEN_REPORT_STATUSES = ["PENDIENTE", "EN_REVISION"] as const;

/**
 * SQL: the row under `idColumn` has a report of `kind` still open. The one
 * rule every purge and every author deletion uses to keep evidence: the
 * stories purge, the disappearing-chat purge and the evidence hold of photos,
 * stories and community comments. `kind` comes from code, never from input.
 */
export const hasOpenReportSql = (kind: string, idColumn: string): string =>
  `EXISTS (SELECT 1 FROM moderation.reports r
            WHERE r.target_kind = '${kind}' AND r.target_id = ${idColumn}
              AND r.status IN (${OPEN_REPORT_STATUSES.map((status) => `'${status}'`).join(", ")}))`;

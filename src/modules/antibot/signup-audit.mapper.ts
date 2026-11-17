import type { SignupAuditRow } from "./signup-audit.repository";

/** Moderation view of a verdict. The IP hash is never exposed, not even to admins. */
export function mapSignupAudit(row: SignupAuditRow) {
  return {
    id: row.id,
    userId: row.userId,
    channel: row.channel,
    risk: row.risk,
    riskReasons: row.riskReasons,
    rejectReason: row.rejectReason,
    accepted: row.rejectReason === null,
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    completedAt: new Date(row.completedAt).toISOString(),
    durationMs: row.durationMs,
    installationId: row.installationId,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

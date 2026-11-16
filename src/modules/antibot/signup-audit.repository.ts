import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes, Transaction } from "sequelize";
import { SignupAuditModel } from "./signup-audit.model";
import type { SignupChannel, SignupRejectReason, SignupRisk } from "./signup-protection.types";

export type SignupAuditEntry = {
  userId: string | null;
  ticketId: string | null;
  startedAt: Date | null;
  completedAt: Date;
  durationMs: number | null;
  channel: SignupChannel;
  risk: SignupRisk;
  riskReasons: string[];
  rejectReason: SignupRejectReason | null;
  ipHmac: string | null;
  installationId: string | null;
};

/** Moderation row: never carries the IP hash. */
export type SignupAuditRow = Omit<SignupAuditEntry, "ipHmac"> & { id: string; createdAt: Date };

export type SignupAuditQuery = {
  risk?: SignupRisk;
  limit: number;
  /** null = every tenant (and rejections, which have none); string = that tenant's accounts only. */
  tenantScope: string | null;
};

@Injectable()
export class SignupAuditRepository {
  constructor(
    @InjectModel(SignupAuditModel)
    private readonly audits: typeof SignupAuditModel,
  ) {}

  async record(entry: SignupAuditEntry, transaction?: Transaction): Promise<void> {
    await this.audits.create({ ...entry }, { transaction });
  }

  /**
   * Newest first. A tenant-scoped reader only sees accepted signups of
   * accounts in its tenant: a rejection has no account, so no tenant.
   */
  listRecent(query: SignupAuditQuery): Promise<SignupAuditRow[]> {
    const conditions: string[] = [];
    if (query.risk) conditions.push("a.risk = :risk");
    if (query.tenantScope !== null) {
      conditions.push(
        "EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = a.user_id AND u.tenant_id = :tenantScope)",
      );
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.audits.sequelize!.query<SignupAuditRow>(
      `SELECT a.id, a.user_id AS "userId", a.ticket_id AS "ticketId", a.started_at AS "startedAt",
              a.completed_at AS "completedAt", a.duration_ms AS "durationMs", a.channel, a.risk,
              a.risk_reasons AS "riskReasons", a.reject_reason AS "rejectReason",
              a.installation_id AS "installationId", a.created_at AS "createdAt"
         FROM auth.signup_audit a
         ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: { risk: query.risk ?? null, tenantScope: query.tenantScope, limit: query.limit },
      },
    );
  }

  /** Drops the IP evidence of rows older than `cutoff`; the verdict itself is kept. */
  async clearIpHashesBefore(cutoff: Date): Promise<number> {
    const [affected] = await this.audits.update(
      { ipHmac: null },
      { where: { createdAt: { [Op.lt]: cutoff }, ipHmac: { [Op.ne]: null } } },
    );
    return affected;
  }
}

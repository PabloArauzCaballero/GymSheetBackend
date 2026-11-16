import { Injectable } from "@nestjs/common";
import type { SignupAuditQueryInput } from "./antibot.schemas";
import { mapSignupAudit } from "./signup-audit.mapper";
import { SignupAuditRepository } from "./signup-audit.repository";

/** Read side of the signup audit for moderators. */
@Injectable()
export class SignupModerationService {
  constructor(private readonly audits: SignupAuditRepository) {}

  /** `tenantScope` null (platform admin) sees everything, rejections included. */
  async listRecent(query: SignupAuditQueryInput, tenantScope: string | null) {
    const rows = await this.audits.listRecent({ ...query, tenantScope });
    return rows.map(mapSignupAudit);
  }
}

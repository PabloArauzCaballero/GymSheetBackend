import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { DomainException } from "../../common/errors/domain.exception";
import { MediaReleaseService } from "../media/media-release.service";
import { KycEffectsRepository } from "./kyc-effects.repository";
import { KycStatus } from "./kyc.catalog";
import { KycRepository } from "./kyc.repository";

/** Why the account is suspended after the business erased its own KYC: it cannot operate without one. */
export const KYC_MISSING = "KYC_MISSING";

export type KycErasureResult = { status: "SUSPENDED"; suspensionReasonCode: typeof KYC_MISSING; kycStatus: KycStatus; documentsErased: number };

/** What an erased attempt becomes: an approval is suspended, an open review is rejected (it can be sent again). */
const AFTER_ERASURE: Partial<Record<KycStatus, { to: KycStatus; decision: "SUSPEND" | "REJECT" }>> = {
  AUTO_APPROVED: { to: "SUSPENDED", decision: "SUSPEND" },
  APPROVED: { to: "SUSPENDED", decision: "SUSPEND" },
  IN_REVIEW: { to: "REJECTED", decision: "REJECT" },
};

/**
 * Erasure of the business's own KYC on request (ADR-0017 applied to the KYC,
 * plan §2.14, ADR-0028). Allowed, but a business cannot operate without a
 * KYC: the account is left SUSPENDED with `KYC_MISSING` and its listing stops
 * being public. Documents go through `media.release`; the encrypted NIT, CI
 * and phone and the representative's name and address are nulled. Masks,
 * HMACs, decisions and history stay (fraud prevention, 5 years after closure).
 */
@Injectable()
export class KycErasureService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: KycRepository,
    private readonly effects: KycEffectsRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  async erase(userId: string, password: string): Promise<KycErasureResult> {
    const [user] = await this.sequelize.query<{ passwordHash: string }>(`SELECT password_hash AS "passwordHash" FROM public.usuarios WHERE id = :userId`, {
      type: QueryTypes.SELECT,
      replacements: { userId },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new DomainException(HttpStatus.BAD_REQUEST, "CURRENT_PASSWORD_INVALID", "La contraseña no es correcta.");
    }
    return this.sequelize.transaction(async (transaction) => {
      const account = await this.effects.findAccount(userId, transaction, true);
      if (!account || account.status === "CLOSED") throw new NotFoundException("Cuenta de negocio no encontrada.");
      const documentsErased = await this.eraseDocuments(userId, transaction);
      await this.sequelize.query(
        `UPDATE business.kyc_submissions SET nit_enc = NULL, rep_ci_enc = NULL, phone_enc = NULL, rep_full_name = NULL, address = NULL,
                rep_ci_complement = NULL, selfie_challenge_code = NULL, selfie_challenge_expires_at = NULL, updated_at = now()
          WHERE account_id = :userId`,
        { replacements: { userId }, transaction },
      );
      const kycStatus = await this.closeAttempts(userId, account.currentSubmissionId, account.kycStatus, transaction);
      const entity = await this.effects.findEntity(account.entityId, transaction);
      if (entity && (entity.status === "ACTIVE" || entity.status === "PAUSED")) {
        await this.effects.setEntityStatus(entity, "SUSPENDED", entity.isVerified, transaction);
      }
      await this.effects.updateAccount(
        userId,
        { status: "SUSPENDED", kyc_status: kycStatus, suspension_reason_code: KYC_MISSING, suspended_at: new Date() },
        {},
        transaction,
      );
      return { status: "SUSPENDED" as const, suspensionReasonCode: KYC_MISSING, kycStatus, documentsErased };
    });
  }

  private async eraseDocuments(userId: string, transaction: Transaction): Promise<number> {
    const rows = await this.sequelize.query<{ id: string; storageKey: string; provider: string }>(
      `WITH target AS (
         SELECT d.id, d.storage_key FROM business.kyc_documents d JOIN business.kyc_submissions s ON s.id = d.submission_id
          WHERE s.account_id = :userId AND d.deleted_at IS NULL FOR UPDATE OF d)
       UPDATE business.kyc_documents d SET storage_key = NULL, deleted_at = now(), delete_reason = 'USER_REQUEST'
         FROM target WHERE d.id = target.id
       RETURNING d.id, target.storage_key AS "storageKey", d.storage_provider AS provider`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    for (const row of rows) {
      await this.mediaRelease.requestRelease(
        { aggregateType: "business.kyc_documents", aggregateId: row.id, provider: row.provider, storageKey: row.storageKey },
        transaction,
      );
    }
    return rows.length;
  }

  /** Every attempt that relied on the erased data leaves its state through the state machine's own records. */
  private async closeAttempts(userId: string, currentSubmissionId: string | null, kycStatus: KycStatus, transaction: Transaction): Promise<KycStatus> {
    const attempts = await this.sequelize.query<{ id: string; status: KycStatus }>(
      `SELECT id, status FROM business.kyc_submissions WHERE account_id = :userId AND status IN ('AUTO_APPROVED', 'APPROVED', 'IN_REVIEW') ORDER BY version FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    let current = kycStatus;
    for (const attempt of attempts) {
      const next = AFTER_ERASURE[attempt.status];
      if (!next) continue;
      const decisionId = await this.repository.insertDecision(
        { submissionId: attempt.id, decision: next.decision, actorUserId: null, reasonCodes: [KYC_MISSING], note: null, allowResubmit: next.decision === "REJECT" ? true : null },
        transaction,
      );
      await this.repository.updateSubmission(attempt.id, { status: next.to, decided_at: new Date() }, transaction);
      await this.repository.insertHistory({ accountId: userId, submissionId: attempt.id, from: attempt.status, to: next.to, decisionId, actorUserId: userId }, transaction);
      if (attempt.id === currentSubmissionId || !currentSubmissionId) current = next.to;
    }
    return current;
  }
}

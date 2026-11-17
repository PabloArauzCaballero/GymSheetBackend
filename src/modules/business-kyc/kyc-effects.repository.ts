import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { RETIRED_LOCK_DAYS, addDays } from "../business-accounts/handle-rules";
import { DirectoryEntityModel } from "../directory/directory-entity.model";
import { KycStatus } from "./kyc.catalog";

export type KycAccountRow = {
  userId: string;
  email: string;
  emailVerifiedAt: Date | null;
  signupRisk: "LOW" | "MEDIUM" | "HIGH" | null;
  entityId: string;
  entityType: DirectoryEntityModel["entityType"];
  legalKind: "COMPANY" | "INDIVIDUAL";
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  kycStatus: KycStatus;
  currentSubmissionId: string | null;
  suspensionReasonCode: string | null;
};

const ACCOUNT_COLUMNS = `a.user_id AS "userId", u.email, u.email_verified_at AS "emailVerifiedAt", u.signup_risk AS "signupRisk",
  a.entity_id AS "entityId", a.entity_type AS "entityType", a.legal_kind AS "legalKind", a.status, a.kyc_status AS "kycStatus",
  a.current_submission_id AS "currentSubmissionId", a.suspension_reason_code AS "suspensionReasonCode"`;

/**
 * What a KYC decision changes outside the KYC tables: the business account,
 * its listing and its `@handle`. Every method runs in the caller's
 * transaction, so the decision and its effects commit together (plan §2.6).
 */
@Injectable()
export class KycEffectsRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(DirectoryEntityModel) private readonly entities: typeof DirectoryEntityModel,
  ) {}

  async findAccount(userId: string, transaction?: Transaction, lock = false): Promise<KycAccountRow | null> {
    const [row] = await this.sequelize.query<KycAccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM business.accounts a JOIN public.usuarios u ON u.id = a.user_id
        WHERE a.user_id = :userId${lock ? " FOR UPDATE OF a" : ""}`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    return row ?? null;
  }

  /** The business account that owns a listing; null for a listing REPP seeded without one. */
  async findAccountByEntity(entityId: string, transaction?: Transaction): Promise<KycAccountRow | null> {
    const [row] = await this.sequelize.query<KycAccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM business.accounts a JOIN public.usuarios u ON u.id = a.user_id WHERE a.entity_id = :entityId`,
      { type: QueryTypes.SELECT, replacements: { entityId }, transaction },
    );
    return row ?? null;
  }

  findEntity(entityId: string, transaction?: Transaction): Promise<DirectoryEntityModel | null> {
    return this.entities.findByPk(entityId, { transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  }

  async updateAccount(
    userId: string,
    patch: Partial<{
      status: KycAccountRow["status"];
      kyc_status: KycStatus;
      current_submission_id: string;
      suspension_reason_code: string | null;
      suspended_at: Date | null;
    }>,
    extra: { firstApproval?: boolean; humanVerification?: boolean },
    transaction: Transaction,
  ): Promise<void> {
    const sets = Object.keys(patch).map((column) => `${column} = :${column}`);
    if (extra.firstApproval) sets.push("first_approved_at = COALESCE(first_approved_at, now())");
    if (extra.humanVerification) sets.push("verified_at = now()");
    await this.sequelize.query(`UPDATE business.accounts SET ${[...sets, "updated_at = now()"].join(", ")} WHERE user_id = :userId`, {
      replacements: { ...patch, userId },
      transaction,
    });
  }

  /** Public listing and public handle. `isVerified` only on a human approval («Verificado por REPP»). */
  async publish(entity: DirectoryEntityModel, isVerified: boolean, transaction: Transaction): Promise<void> {
    await entity.update({ status: "ACTIVE", isVerified }, { transaction });
    await this.sequelize.query(
      `UPDATE directory.handles SET status = 'ACTIVE', updated_at = now() WHERE owner_entity_id = :entityId AND status = 'PENDING'`,
      { replacements: { entityId: entity.id }, transaction },
    );
  }

  /** Back to a non-public draft whose handle is a reservation again (rejected, may resubmit). */
  async unpublish(entity: DirectoryEntityModel, transaction: Transaction): Promise<void> {
    await entity.update({ status: "DRAFT", isVerified: false }, { transaction });
    await this.sequelize.query(
      `UPDATE directory.handles SET status = 'PENDING', updated_at = now() WHERE owner_entity_id = :entityId AND status = 'ACTIVE'`,
      { replacements: { entityId: entity.id }, transaction },
    );
  }

  async setEntityStatus(entity: DirectoryEntityModel, status: "ACTIVE" | "SUSPENDED", isVerified: boolean, transaction: Transaction): Promise<void> {
    await entity.update({ status, isVerified }, { transaction });
  }

  /**
   * A definitive rejection frees the name: a reservation that was never public
   * is deleted; a public handle retires without redirect and stays locked, so
   * it cannot be taken over to impersonate the rejected business.
   */
  async releaseHandle(entityId: string, now: Date, transaction: Transaction): Promise<void> {
    await this.sequelize.query(`DELETE FROM directory.handles WHERE owner_entity_id = :entityId AND status = 'PENDING'`, {
      replacements: { entityId },
      transaction,
    });
    await this.sequelize.query(
      `UPDATE directory.handles SET status = 'RETIRED', redirect_to_handle = NULL, redirect_until = NULL,
              locked_until = :lockedUntil, updated_at = now()
        WHERE owner_entity_id = :entityId AND status = 'ACTIVE'`,
      { replacements: { entityId, lockedUntil: addDays(now, RETIRED_LOCK_DAYS) }, transaction },
    );
  }

  /** An approved material change: the listing takes the reviewed name and category. */
  async applyMaterialChange(
    entity: DirectoryEntityModel,
    change: { tradeName: string | null; primaryCategoryId: string | null },
    transaction: Transaction,
  ): Promise<void> {
    const patch: Partial<Pick<DirectoryEntityModel, "name" | "primaryCategoryId">> = {};
    if (change.tradeName && change.tradeName !== entity.name) patch.name = change.tradeName;
    if (change.primaryCategoryId && change.primaryCategoryId !== entity.primaryCategoryId) patch.primaryCategoryId = change.primaryCategoryId;
    if (Object.keys(patch).length === 0) return;
    await entity.update(patch, { transaction });
    if (patch.name) {
      await this.sequelize.query(`UPDATE public.usuarios SET nombre_completo = :name, updated_at = now() WHERE id = :userId`, {
        replacements: { name: patch.name, userId: entity.userId },
        transaction,
      });
    }
  }
}

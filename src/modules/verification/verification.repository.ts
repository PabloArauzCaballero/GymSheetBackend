import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { PhotoVerificationModel } from "./photo-verification.model";
import {
  VerificationGestureCode,
  VerificationRejectionReason,
  VerificationStatus,
  VerificationStatusValue,
} from "./verification.catalog";

export type QueueRow = { verification: PhotoVerificationModel; memberName: string };
export type MemberPhoto = { userId: string; id: string; url: string };

/** Data access of `social.photo_verifications` plus the user/photo facts it needs. */
@Injectable()
export class VerificationRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(PhotoVerificationModel) private readonly rows: typeof PhotoVerificationModel,
  ) {}

  /** Locks the account row: serializes challenges and decisions per member. */
  async lockUser(userId: string, transaction: Transaction): Promise<{ verifiedAt: Date | null } | null> {
    const [row] = await this.sequelize.query<{ verified_at: Date | null }>(
      `SELECT verified_at FROM public.usuarios WHERE id = :userId FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    return row ? { verifiedAt: row.verified_at } : null;
  }

  async userVerifiedAt(userId: string): Promise<Date | null> {
    const [row] = await this.sequelize.query<{ verified_at: Date | null }>(
      `SELECT verified_at FROM public.usuarios WHERE id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row?.verified_at ?? null;
  }

  async setUserVerifiedAt(userId: string, verifiedAt: Date | null, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE public.usuarios SET verified_at = :verifiedAt WHERE id = :userId`,
      { replacements: { userId, verifiedAt }, transaction },
    );
  }

  /** Photos the member and everybody else can see (moderation-hidden ones excluded). */
  async visiblePhotos(userIds: readonly string[], transaction?: Transaction): Promise<MemberPhoto[]> {
    if (userIds.length === 0) return [];
    return this.sequelize.query<MemberPhoto>(
      `SELECT user_id AS "userId", id, url FROM profile.photos
        WHERE user_id IN (:userIds) AND hidden_at IS NULL
        ORDER BY user_id, position, created_at`,
      { type: QueryTypes.SELECT, replacements: { userIds }, transaction },
    );
  }

  async countExistingPhotos(userId: string, photoIds: readonly string[], transaction: Transaction): Promise<number> {
    if (photoIds.length === 0) return 0;
    const [row] = await this.sequelize.query<{ total: string }>(
      `SELECT count(*) AS total FROM profile.photos
        WHERE user_id = :userId AND id IN (:photoIds) AND hidden_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: { userId, photoIds }, transaction },
    );
    return Number(row?.total ?? 0);
  }

  findLatestForUser(userId: string, transaction?: Transaction): Promise<PhotoVerificationModel | null> {
    return this.rows.findOne({ where: { userId }, order: [["createdAt", "DESC"]], transaction });
  }

  findLatestDecided(userId: string): Promise<PhotoVerificationModel | null> {
    return this.rows.findOne({
      where: { userId, decidedAt: { [Op.ne]: null } },
      order: [["decidedAt", "DESC"]],
    });
  }

  findLatestApproved(userId: string, transaction: Transaction): Promise<PhotoVerificationModel | null> {
    return this.rows.findOne({
      where: { userId, status: VerificationStatus.APPROVED },
      order: [["decidedAt", "DESC"]],
      transaction,
    });
  }

  findActiveForUser(userId: string, transaction: Transaction): Promise<PhotoVerificationModel | null> {
    return this.rows.findOne({
      where: { userId, status: [VerificationStatus.PENDING_UPLOAD, VerificationStatus.PENDING_REVIEW] },
      transaction,
    });
  }

  async attemptDatesSince(userId: string, since: Date, transaction?: Transaction): Promise<Date[]> {
    const rows = await this.rows.findAll({
      attributes: ["createdAt"],
      where: { userId, createdAt: { [Op.gt]: since } },
      order: [["createdAt", "DESC"]],
      transaction,
    });
    return rows.map((row) => row.createdAt);
  }

  findByIdForUser(id: string, userId: string, transaction?: Transaction): Promise<PhotoVerificationModel | null> {
    return this.rows.findOne({ where: { id, userId }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  }

  /** Row visible to a moderator: any tenant for platform admins, else their gym only. */
  async findByIdInScope(
    id: string,
    tenantScope: string | null,
    transaction?: Transaction,
  ): Promise<PhotoVerificationModel | null> {
    const row = await this.rows.findOne({
      where: { id },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
    if (!row || tenantScope === null) return row;
    const [owner] = await this.sequelize.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM public.usuarios WHERE id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId: row.userId }, transaction },
    );
    return owner?.tenant_id === tenantScope ? row : null;
  }

  create(
    input: { userId: string; gestureCode: VerificationGestureCode; issuedAt: Date; expiresAt: Date },
    transaction: Transaction,
  ): Promise<PhotoVerificationModel> {
    return this.rows.create(
      {
        userId: input.userId,
        gestureCode: input.gestureCode,
        challengeIssuedAt: input.issuedAt,
        challengeExpiresAt: input.expiresAt,
        status: VerificationStatus.PENDING_UPLOAD,
      },
      { transaction },
    );
  }

  async update(
    id: string,
    changes: Partial<{
      status: VerificationStatusValue;
      selfieStorageKey: string | null;
      selfieMimeType: string | null;
      selfieDeletedAt: Date;
      submittedAt: Date;
      reviewerId: string;
      decisionReason: VerificationRejectionReason | null;
      decidedAt: Date;
      approvedPhotoIds: string[];
      revokedAt: Date;
    }>,
    transaction?: Transaction,
  ): Promise<void> {
    await this.rows.update(changes, { where: { id }, transaction });
  }

  async listQueue(status: VerificationStatusValue, limit: number, tenantScope: string | null): Promise<QueueRow[]> {
    const ids = await this.sequelize.query<{ id: string; member_name: string }>(
      `SELECT v.id, u.nombre_completo AS member_name
         FROM social.photo_verifications v
         JOIN public.usuarios u ON u.id = v.user_id
        WHERE v.status = :status AND (CAST(:tenantScope AS varchar) IS NULL OR u.tenant_id = :tenantScope)
        ORDER BY COALESCE(v.submitted_at, v.created_at), v.id
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { status, limit, tenantScope } },
    );
    if (ids.length === 0) return [];
    const models = await this.rows.findAll({ where: { id: ids.map((row) => row.id) } });
    const byId = new Map(models.map((model) => [model.id, model]));
    return ids.flatMap((row) => {
      const verification = byId.get(row.id);
      return verification ? [{ verification, memberName: row.member_name }] : [];
    });
  }

  /** Abandoned challenges (never answered) become EXPIRED. */
  async expireAbandoned(issuedBefore: Date): Promise<number> {
    const [count] = await this.rows.update(
      { status: VerificationStatus.EXPIRED },
      { where: { status: VerificationStatus.PENDING_UPLOAD, challengeIssuedAt: { [Op.lte]: issuedBefore } } },
    );
    return count;
  }

  findSelfiesToErase(decidedBefore: Date, limit: number): Promise<PhotoVerificationModel[]> {
    return this.rows.findAll({
      where: {
        selfieStorageKey: { [Op.ne]: null },
        [Op.or]: [
          { status: VerificationStatus.EXPIRED },
          {
            status: [VerificationStatus.APPROVED, VerificationStatus.REJECTED],
            decidedAt: { [Op.lte]: decidedBefore },
          },
        ],
      },
      order: [["createdAt", "ASC"]],
      limit,
    });
  }

  /** Clears the key only if it is still the one whose file was removed. */
  async clearSelfie(id: string, storageKey: string, now: Date): Promise<void> {
    await this.rows.update(
      { selfieStorageKey: null, selfieMimeType: null, selfieDeletedAt: now },
      { where: { id, selfieStorageKey: storageKey } },
    );
  }
}

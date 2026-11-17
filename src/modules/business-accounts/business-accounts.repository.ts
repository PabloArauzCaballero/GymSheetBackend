import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DirectoryEntityModel, DirectoryEntityType } from '../directory/directory-entity.model';
import { LegalKind } from './business-accounts.schemas';

export type BusinessAccountStatus = 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

/** `business.accounts` joined with the owner's login fields. */
export type BusinessAccountRow = {
  userId: string;
  email: string;
  emailVerifiedAt: Date | null;
  entityId: string;
  entityType: DirectoryEntityType;
  legalKind: LegalKind;
  status: BusinessAccountStatus;
  kycStatus: string;
  createdAt: Date;
};

@Injectable()
export class BusinessAccountsRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(DirectoryEntityModel) private readonly entityModel: typeof DirectoryEntityModel,
  ) {}

  /** The listing is born DRAFT: not public until the KYC approves it (franja 8b). */
  createDraftEntity(
    input: { slug: string; name: string; entityType: DirectoryEntityType; ownerUserId: string },
    transaction: Transaction,
  ): Promise<DirectoryEntityModel> {
    return this.entityModel.create(
      {
        slug: input.slug,
        entityType: input.entityType,
        name: input.name,
        description: '',
        primaryCategoryId: null,
        userId: input.ownerUserId,
        tenantId: null,
        status: 'DRAFT',
        isVerified: false,
      },
      { transaction },
    );
  }

  async createAccount(
    input: { userId: string; entityId: string; entityType: DirectoryEntityType; legalKind: LegalKind },
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO business.accounts (user_id, entity_id, entity_type, legal_kind)
       VALUES (:userId, :entityId, :entityType, :legalKind)`,
      { replacements: input, type: QueryTypes.INSERT, transaction },
    );
  }

  async findByUserId(userId: string, transaction?: Transaction): Promise<BusinessAccountRow | null> {
    const [row] = await this.sequelize.query<BusinessAccountRow>(
      `SELECT a.user_id AS "userId", u.email, u.email_verified_at AS "emailVerifiedAt",
              a.entity_id AS "entityId", a.entity_type AS "entityType", a.legal_kind AS "legalKind",
              a.status, a.kyc_status AS "kycStatus", a.created_at AS "createdAt"
         FROM business.accounts a
         JOIN public.usuarios u ON u.id = a.user_id
        WHERE a.user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT, transaction },
    );
    return row ?? null;
  }

  findEntity(entityId: string, transaction?: Transaction): Promise<DirectoryEntityModel | null> {
    return this.entityModel.findByPk(entityId, { transaction });
  }

  /** Serializes every write to one listing (profile, media, handle). */
  lockEntity(entityId: string, transaction: Transaction): Promise<DirectoryEntityModel | null> {
    return this.entityModel.findByPk(entityId, { transaction, lock: transaction.LOCK.UPDATE });
  }

  async updateEntity(
    entity: DirectoryEntityModel,
    patch: Partial<Pick<DirectoryEntityModel, EditableEntityField>>,
    transaction: Transaction,
  ): Promise<void> {
    await entity.update(patch, { transaction });
  }

  /**
   * Who blocks a commercial name: a REPP-protected brand (`RESERVED` handle) or
   * a public listing of the same type with the same stored skeleton. Both
   * sides were folded by `businessNameSkeleton` in the application; served by
   * `ix_directory_entities_active_name_skeleton`.
   */
  async findNameHolder(
    skeleton: string,
    entityType: DirectoryEntityType,
    exceptEntityId: string | null,
    transaction?: Transaction,
  ): Promise<'RESERVED' | 'TOO_SIMILAR' | null> {
    const [row] = await this.sequelize.query<{ reason: 'RESERVED' | 'TOO_SIMILAR' | null }>(
      `SELECT CASE
                WHEN EXISTS (SELECT 1 FROM directory.handles h WHERE h.status = 'RESERVED' AND h.skeleton = :skeleton)
                  THEN 'RESERVED'
                WHEN EXISTS (SELECT 1 FROM directory.entities e
                              WHERE e.status = 'ACTIVE' AND e.entity_type = :entityType AND e.name_skeleton = :skeleton
                                AND e.id IS DISTINCT FROM :exceptEntityId)
                  THEN 'TOO_SIMILAR'
              END AS reason`,
      { replacements: { skeleton, entityType, exceptEntityId }, type: QueryTypes.SELECT, transaction },
    );
    return row?.reason ?? null;
  }

  /** An active category whose scope fits the listing type (or `ALL`). */
  async categoryFits(categoryId: string, entityType: DirectoryEntityType): Promise<boolean> {
    const [row] = await this.sequelize.query<{ fits: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM directory.categories
                       WHERE id = :categoryId AND is_active
                         AND entity_scope IN (:entityType, 'ALL')) AS fits`,
      { replacements: { categoryId, entityType }, type: QueryTypes.SELECT },
    );
    return row?.fits === true;
  }
}

export type EditableEntityField =
  | 'name'
  | 'headline'
  | 'description'
  | 'primaryCategoryId'
  | 'city'
  | 'country'
  | 'address'
  | 'isOnlineOnly'
  | 'contactInfo'
  | 'businessHours'
  | 'logoUrl'
  | 'coverUrl';

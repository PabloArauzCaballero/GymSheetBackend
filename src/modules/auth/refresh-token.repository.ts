import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { RefreshTokenRevokedReason } from '../../common/enums/domain.enums';
import { RefreshTokenModel } from './refresh-token.model';

export type CreateRefreshTokenInput = {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
};

@Injectable()
export class RefreshTokenRepository {
  constructor(@InjectModel(RefreshTokenModel) private readonly model: typeof RefreshTokenModel) {}

  create(input: CreateRefreshTokenInput, transaction?: Transaction): Promise<RefreshTokenModel> {
    return this.model.create({ ...input }, { transaction });
  }

  /** Looked up regardless of revocation state: a revoked hit is itself the
   * reuse signal the caller needs to act on. */
  findByHash(tokenHash: string, transaction?: Transaction): Promise<RefreshTokenModel | null> {
    return this.model.findOne({ where: { tokenHash }, transaction });
  }

  revoke(id: string, reason: RefreshTokenRevokedReason, transaction?: Transaction): Promise<[affectedCount: number]> {
    return this.model.update(
      { revokedAt: new Date(), revokedReason: reason },
      { where: { id }, transaction },
    );
  }

  revokeFamily(
    familyId: string,
    reason: RefreshTokenRevokedReason,
    transaction?: Transaction,
  ): Promise<[affectedCount: number]> {
    return this.model.update(
      { revokedAt: new Date(), revokedReason: reason },
      { where: { familyId, revokedAt: null }, transaction },
    );
  }

  revokeAllForUser(
    userId: string,
    reason: RefreshTokenRevokedReason,
    transaction?: Transaction,
  ): Promise<[affectedCount: number]> {
    return this.model.update(
      { revokedAt: new Date(), revokedReason: reason },
      { where: { userId, revokedAt: null }, transaction },
    );
  }
}

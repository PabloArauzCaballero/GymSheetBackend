import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { PasswordResetTokenModel } from './password-reset-token.model';

export type CreatePasswordResetTokenInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

@Injectable()
export class PasswordResetTokenRepository {
  constructor(
    @InjectModel(PasswordResetTokenModel) private readonly model: typeof PasswordResetTokenModel,
  ) {}

  create(input: CreatePasswordResetTokenInput, transaction?: Transaction): Promise<PasswordResetTokenModel> {
    return this.model.create({ ...input }, { transaction });
  }

  /** The row `confirmPasswordReset` checks a presented PIN against — at most
   * one per user, since a fresh request invalidates whatever came before. */
  findActiveForUser(userId: string, transaction?: Transaction): Promise<PasswordResetTokenModel | null> {
    return this.model.findOne({
      where: { userId, usedAt: null },
      order: [['createdAt', 'DESC']],
      transaction,
    });
  }

  /** Burns every still-usable code a user has outstanding. Called both when a
   * fresh code is requested (so only the newest one works) and when a code
   * is spent, successfully or by exhausting its attempt budget. */
  invalidateActiveForUser(userId: string, transaction?: Transaction): Promise<[affectedCount: number]> {
    return this.model.update(
      { usedAt: new Date() },
      { where: { userId, usedAt: null }, transaction },
    );
  }

  async incrementAttempts(id: string, transaction?: Transaction): Promise<void> {
    await this.model.increment('attempts', { where: { id }, transaction });
  }
}

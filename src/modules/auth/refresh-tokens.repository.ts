import { Injectable } from '@nestjs/common';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

export type StoredRefreshToken = {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type NewRefreshToken = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
};

/** Data access for `auth.refresh_tokens`. Only hashes are ever stored or queried. */
@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly sequelize: Sequelize) {}

  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  async insert(token: NewRefreshToken, transaction?: Transaction): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO auth.refresh_tokens (id, user_id, family_id, token_hash, expires_at)
       VALUES (:id, :userId, :familyId, :tokenHash, :expiresAt)`,
      { replacements: token, type: QueryTypes.INSERT, transaction },
    );
  }

  /** Locks the row so two concurrent refreshes of the same token cannot both rotate it. */
  async findByHashForUpdate(
    tokenHash: string,
    transaction: Transaction,
  ): Promise<StoredRefreshToken | null> {
    const rows = await this.sequelize.query<StoredRefreshToken>(
      `SELECT id,
              user_id AS "userId",
              family_id AS "familyId",
              expires_at AS "expiresAt",
              revoked_at AS "revokedAt"
         FROM auth.refresh_tokens
        WHERE token_hash = :tokenHash
        FOR UPDATE`,
      { replacements: { tokenHash }, type: QueryTypes.SELECT, transaction },
    );
    return rows[0] ?? null;
  }

  async markRotated(
    tokenId: string,
    replacedById: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.refresh_tokens
          SET revoked_at = now(), replaced_by_id = :replacedById
        WHERE id = :tokenId`,
      { replacements: { tokenId, replacedById }, type: QueryTypes.UPDATE, transaction },
    );
  }

  async revokeFamily(familyId: string, transaction?: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.refresh_tokens
          SET revoked_at = now()
        WHERE family_id = :familyId AND revoked_at IS NULL`,
      { replacements: { familyId }, type: QueryTypes.UPDATE, transaction },
    );
  }
}

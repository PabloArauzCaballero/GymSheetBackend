import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { EntityPaymentConfigModel } from '../directory/models/entity-payment-config.model';

/** A seller as the orders see it: only an entity with a business account sells (ADR-0024). */
export type SellerRow = {
  entityId: string;
  entityType: string;
  entityStatus: string;
  ownerUserId: string;
  accountStatus: string;
  /** «Verificado por REPP» (a human approval, ADR-0021); an automatic approval alone is «Nuevo». */
  isVerified: boolean;
};

/** Sellers and their payment configuration (`directory.entity_payment_configs`). */
@Injectable()
export class SellersRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(EntityPaymentConfigModel) private readonly configs: typeof EntityPaymentConfigModel,
  ) {}

  async findSeller(entityId: string, transaction?: Transaction): Promise<SellerRow | null> {
    const [row] = await this.sequelize.query<SellerRow>(
      `SELECT e.id AS "entityId", e.entity_type AS "entityType", e.status AS "entityStatus", a.user_id AS "ownerUserId", a.status AS "accountStatus",
              e.is_verified AS "isVerified"
         FROM directory.entities e JOIN business.accounts a ON a.entity_id = e.id
        WHERE e.id = :entityId`,
      { type: QueryTypes.SELECT, replacements: { entityId }, transaction },
    );
    return row ?? null;
  }

  /**
   * Open orders of one seller, counted under a per-seller advisory lock (held
   * to commit): two buyers ordering at once cannot both take the last place.
   */
  async lockAndCountOpenOrders(entityId: string, transaction: Transaction): Promise<number> {
    await this.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key: `order-seller:${entityId}` }, transaction });
    const [row] = await this.sequelize.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM directory.payment_orders WHERE entity_id = :entityId AND status IN ('PENDING_PAYMENT', 'PENDING_VERIFICATION')`,
      { type: QueryTypes.SELECT, replacements: { entityId }, transaction },
    );
    return row?.count ?? 0;
  }

  findConfig(entityId: string, transaction?: Transaction): Promise<EntityPaymentConfigModel | null> {
    return this.configs.findOne({ where: { entityId }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  }

  async saveConfig(entityId: string, data: Partial<EntityPaymentConfigModel>, transaction: Transaction): Promise<EntityPaymentConfigModel> {
    const existing = await this.findConfig(entityId, transaction);
    if (existing) return existing.update(data, { transaction });
    return this.configs.create({ entityId, ...data } as never, { transaction });
  }

  /**
   * Best trigram similarity of the account holder against the legal name and
   * the representative of the business's approved KYC attempt; null when there
   * is no approved attempt or neither name. Both sides go through
   * `repp_normalize` (no case, accents or punctuation).
   */
  async holderSimilarity(entityId: string, holder: string, transaction: Transaction): Promise<{ score: number | null; submissionId: string | null }> {
    const [row] = await this.sequelize.query<{ score: string | null; submissionId: string | null }>(
      `SELECT s.id AS "submissionId",
              GREATEST(similarity(public.repp_normalize(:holder), public.repp_normalize(NULLIF(s.legal_name, ''))),
                       similarity(public.repp_normalize(:holder), public.repp_normalize(NULLIF(s.rep_full_name, '')))) AS score
         FROM business.accounts a
         LEFT JOIN business.kyc_submissions s ON s.id = a.current_submission_id
        WHERE a.entity_id = :entityId`,
      { type: QueryTypes.SELECT, replacements: { entityId, holder }, transaction },
    );
    return { score: row?.score === null || row?.score === undefined ? null : Number(row.score), submissionId: row?.submissionId ?? null };
  }

  /** Flags REPP's post-review of the KYC attempt (append-only `kyc_checks`); no personal data in the detail. */
  async flagHolderMismatch(submissionId: string, similarity: number, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO business.kyc_checks (submission_id, code, outcome, detail)
       VALUES (:submissionId, 'PAYMENT_HOLDER_MATCH', 'WARN', CAST(:detail AS jsonb))`,
      { replacements: { submissionId, detail: JSON.stringify({ similarity: Number(similarity.toFixed(3)) }) }, transaction },
    );
  }
}

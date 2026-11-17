import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Transaction, WhereOptions, literal } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { bannedTermExistsSql } from '../../common/sql/banned-terms';
import { EntityPlanModel, ListingModerationStatus, ListingOfferKind } from '../directory/models/entity-plan.model';
import { PlanPriceHistoryModel } from '../directory/models/plan-price-history.model';

/** A keyset position: the timestamp as the database's own text (microseconds) and the row id. */
export type KeysetAfter = { key: string; id: string };

/** `created_at` at full precision, ISO in UTC: a JS Date would truncate it to milliseconds and loop pages. */
export const CREATED_KEY_SQL = `to_char("EntityPlanModel"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The business's own listings (`directory.entity_plans`) and the data its publication checks read. */
@Injectable()
export class BusinessListingsRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(EntityPlanModel) private readonly listings: typeof EntityPlanModel,
    @InjectModel(PlanPriceHistoryModel) private readonly prices: typeof PlanPriceHistoryModel,
  ) {}

  create(data: Partial<EntityPlanModel>, transaction: Transaction): Promise<EntityPlanModel> {
    return this.listings.create(data as never, { transaction });
  }

  /** A listing of this entity, or null: another business's listing is never found (404). */
  findOwn(entityId: string, listingId: string, transaction?: Transaction): Promise<EntityPlanModel | null> {
    return this.listings.findOne({
      where: { id: listingId, entityId },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  /** Newest first, keyset on (created_at, id) — `ix_entity_plans_entity_created`. */
  async listOwn(
    entityId: string,
    filter: { status?: string; moderationStatus?: ListingModerationStatus },
    after: KeysetAfter | null,
    limit: number,
  ): Promise<(EntityPlanModel & { cursorKey: string })[]> {
    const where: WhereOptions = {
      entityId,
      ...(filter.status ? { status: filter.status } : { status: { [Op.ne]: 'ARCHIVED' } }),
      ...(filter.moderationStatus ? { moderationStatus: filter.moderationStatus } : {}),
      // Both values are validated (ISO instant, UUID) and escaped by the driver.
      ...(after
        ? {
            [Op.and]: [
              literal(
                `("EntityPlanModel"."created_at", "EntityPlanModel"."id") < (CAST(${this.sequelize.escape(after.key)} AS timestamptz), CAST(${this.sequelize.escape(after.id)} AS uuid))`,
              ),
            ],
          }
        : {}),
    };
    const rows = await this.listings.findAll({
      where,
      attributes: { include: [[literal(CREATED_KEY_SQL), 'cursorKey']] },
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit,
    });
    return rows.map((row) => Object.assign(row, { cursorKey: String(row.get('cursorKey')) }));
  }

  /** Listings of an entity that are not archived (counted under the entity's row lock). */
  countOpen(entityId: string, transaction: Transaction): Promise<number> {
    return this.listings.count({ where: { entityId, status: { [Op.ne]: 'ARCHIVED' } }, transaction });
  }

  async update(listing: EntityPlanModel, patch: Partial<EntityPlanModel>, transaction: Transaction): Promise<void> {
    await listing.update(patch, { transaction });
  }

  /** Median price of the public listings of a kind; null under `minSamples` of them. */
  async priceMedian(offerKind: ListingOfferKind, minSamples: number, transaction: Transaction): Promise<number | null> {
    const [row] = await this.sequelize.query<{ median: string | null; samples: string }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.current_price) AS median, count(*) AS samples
         FROM directory.entity_plans p
         JOIN directory.entities e ON e.id = p.entity_id AND e.status = 'ACTIVE'
        WHERE p.offer_kind = :offerKind AND p.moderation_status = 'LIVE' AND p.status = 'ACTIVE'`,
      { type: QueryTypes.SELECT, replacements: { offerKind }, transaction },
    );
    if (!row || Number(row.samples) < minSamples || row.median === null) return null;
    return Number(row.median);
  }

  async containsBannedTerm(texts: readonly string[], transaction: Transaction): Promise<boolean> {
    const rows = await this.sequelize.query(`SELECT EXISTS (${bannedTermExistsSql('LISTING')}) AS hit`, {
      type: QueryTypes.SELECT,
      replacements: { text: texts.join(' ') },
      transaction,
    });
    return (rows[0] as { hit?: boolean } | undefined)?.hit === true;
  }

  /** Append-only price history (`directory.plan_price_history`): close the current row, open the new one. */
  async recordPrice(
    input: { listingId: string; price: string; currency: string; actorUserId: string; reason: string; at: Date },
    transaction: Transaction,
  ): Promise<void> {
    await this.prices.update(
      { effectiveTo: input.at },
      { where: { planId: input.listingId, effectiveTo: null }, transaction },
    );
    await this.prices.create(
      {
        planId: input.listingId,
        price: input.price,
        currency: input.currency,
        effectiveFrom: input.at,
        effectiveTo: null,
        changedByUserId: input.actorUserId,
        changeReason: input.reason,
        isPromotional: false,
      } as never,
      { transaction },
    );
  }
}

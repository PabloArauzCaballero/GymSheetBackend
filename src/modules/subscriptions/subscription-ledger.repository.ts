import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { MembershipStatus } from '../../common/enums/domain.enums';
import { MembershipStatusHistoryModel } from '../membership/membership-status-history.model';
import { MembershipModel } from '../membership/membership.model';

export type LiveSocio = { id: string; status: 'REQUESTED' | 'CONFIRMED' };

/** Writes of the subscription ledger (`membership.memberships` and its append-only `status_history`). */
@Injectable()
export class SubscriptionLedgerRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(MembershipModel) private readonly periods: typeof MembershipModel,
    @InjectModel(MembershipStatusHistoryModel) private readonly history: typeof MembershipStatusHistoryModel,
  ) {}

  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  /** End of the latest ACTIVE period of this person for this listing (`ix_memberships_chain`); the caller holds the person's lock. */
  async lastActiveEnd(userId: string, entityPlanId: string, transaction: Transaction): Promise<string | null> {
    const [row] = await this.sequelize.query<{ endsOn: string | null }>(
      `SELECT max(ends_on)::text AS "endsOn" FROM membership.memberships
        WHERE user_id = :userId AND entity_plan_id = :entityPlanId AND status = 'ACTIVE'`,
      { type: QueryTypes.SELECT, replacements: { userId, entityPlanId }, transaction },
    );
    return row?.endsOn ?? null;
  }

  /** The person's live SOCIO affiliation at this gym, if any (`ux_affiliations_live_person`). */
  async liveSocioAt(userId: string, gymEntityId: string, transaction: Transaction): Promise<LiveSocio | null> {
    const [row] = await this.sequelize.query<LiveSocio>(
      `SELECT id, status FROM directory.affiliations
        WHERE user_id = :userId AND gym_entity_id = :gymEntityId AND kind = 'SOCIO' AND status IN ('REQUESTED', 'CONFIRMED')`,
      { type: QueryTypes.SELECT, replacements: { userId, gymEntityId }, transaction },
    );
    return row ?? null;
  }

  /** What a listing sells now: the fallback for an order older than its snapshot fields. */
  async listingOffer(entityPlanId: string, transaction: Transaction) {
    const [row] = await this.sequelize.query<{ offerKind: string; validityDays: number | null; sessionsCount: number | null; name: string }>(
      `SELECT offer_kind AS "offerKind", duration_days AS "validityDays", sessions_count AS "sessionsCount", name
         FROM directory.entity_plans WHERE id = :entityPlanId`,
      { type: QueryTypes.SELECT, replacements: { entityPlanId }, transaction },
    );
    return row ?? null;
  }

  create(data: Partial<MembershipModel>, transaction: Transaction): Promise<MembershipModel> {
    return this.periods.create(data as never, { transaction });
  }

  /** A period of this seller, row-locked; another seller's (or a legacy row) is never found. */
  lockOfSeller(entityId: string, periodId: string, transaction: Transaction): Promise<MembershipModel | null> {
    return this.periods.findOne({ where: { id: periodId, entityId, origin: 'MARKETPLACE' }, transaction, lock: transaction.LOCK.UPDATE });
  }

  findOfSeller(entityId: string, periodId: string): Promise<MembershipModel | null> {
    return this.periods.findOne({ where: { id: periodId, entityId, origin: 'MARKETPLACE' } });
  }

  async update(period: MembershipModel, patch: Partial<MembershipModel>, transaction: Transaction): Promise<void> {
    await period.update(patch, { transaction });
  }

  async recordStatus(
    input: { membershipId: string; fromStatus: MembershipStatus | null; toStatus: MembershipStatus; reason: string | null; actorUserId: string | null; domainEventId: string; metadata: Record<string, unknown> },
    transaction: Transaction,
  ): Promise<void> {
    await this.history.create(input as never, { transaction });
  }
}

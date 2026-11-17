import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { PaymentOrderModel, PaymentOrderStatus } from '../directory/models/payment-order.model';
import { PlanPriceHistoryModel } from '../directory/models/plan-price-history.model';
import { OrderKeyset } from './order-cursor';

/** One row of a list (inbox or "Mis compras"): the order and what the reader needs next to it. */
export type OrderListRow = {
  id: string;
  orderNumber: string;
  status: PaymentOrderStatus;
  method: 'QR' | 'CASH';
  quantity: number;
  unitAmount: string;
  amount: string;
  currency: string;
  planSnapshot: Record<string, unknown>;
  entityId: string;
  sellerName: string;
  sellerHandle: string | null;
  sellerLogoUrl: string | null;
  buyerName: string;
  expiresAt: Date | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  rejectionCode: string | null;
  rejectionReason: string | null;
  receiptReference: string | null;
  buyerNote: string | null;
  hasReceipt: boolean;
  createdAt: Date;
  bucket: number;
  sortKey: string;
};

export type OrderHistoryRow = { fromStatus: string | null; toStatus: string; reasonCode: string | null; at: Date; byBuyer: boolean; bySystem: boolean };

type Scope = { buyerId: string } | { entityId: string };

/**
 * Sort of a list. The business inbox puts "Por confirmar" first (bucket 0,
 * oldest first: the most urgent) and the rest after (bucket 1, newest first);
 * "Mis compras" is newest first. Ascending everywhere, so one keyset works.
 */
function order(scope: Scope): { bucket: string; sort: string } {
  // A bare `0` in ORDER BY is a column position for PostgreSQL; the cast makes it a constant expression.
  if ('buyerId' in scope) return { bucket: 'CAST(0 AS int)', sort: '-extract(epoch FROM o.created_at)' };
  return {
    bucket: `CASE WHEN o.status = 'PENDING_VERIFICATION' THEN 0 ELSE 1 END`,
    sort: `CASE WHEN o.status = 'PENDING_VERIFICATION' THEN extract(epoch FROM COALESCE(o.submitted_at, o.created_at))
                ELSE -extract(epoch FROM o.created_at) END`,
  };
}

const listSelect = (scope: Scope) => `
  SELECT o.id, o.order_number AS "orderNumber", o.status, o.method, o.quantity, o.unit_amount AS "unitAmount", o.amount,
         o.currency, o.plan_snapshot AS "planSnapshot", o.entity_id AS "entityId", e.name AS "sellerName",
         h.handle AS "sellerHandle", e.logo_url AS "sellerLogoUrl", u.nombre_completo AS "buyerName",
         o.expires_at AS "expiresAt", o.submitted_at AS "submittedAt", o.decided_at AS "decidedAt",
         o.cancelled_at AS "cancelledAt", o.cancel_reason AS "cancelReason", o.rejection_code AS "rejectionCode",
         o.rejection_reason AS "rejectionReason", o.receipt_reference AS "receiptReference", o.athlete_notes AS "buyerNote",
         (o.receipt_private_key IS NOT NULL) AS "hasReceipt", o.created_at AS "createdAt",
         ${order(scope).bucket} AS bucket, (${order(scope).sort})::text AS "sortKey"
    FROM directory.payment_orders o
    JOIN directory.entities e ON e.id = o.entity_id
    JOIN public.usuarios u ON u.id = o.athlete_user_id
    LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'`;

/** Orders, their history and the listing stock they reserve (`directory.payment_orders`, ADR-0024). */
@Injectable()
export class OrdersRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(PaymentOrderModel) private readonly orders: typeof PaymentOrderModel,
    @InjectModel(EntityPlanModel) private readonly listings: typeof EntityPlanModel,
    @InjectModel(PlanPriceHistoryModel) private readonly prices: typeof PlanPriceHistoryModel,
  ) {}

  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  /** Serializes one person's order creations: the open-orders cap cannot be passed by parallel requests. */
  async lockBuyer(userId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('payment-order-buyer:' || :userId))`, {
      replacements: { userId },
      transaction,
    });
  }

  /** The listing, row-locked, with its seller: the stock check and the reservation happen under this lock. */
  lockListing(listingId: string, transaction: Transaction): Promise<EntityPlanModel | null> {
    return this.listings.findByPk(listingId, { transaction, lock: transaction.LOCK.UPDATE });
  }

  findCurrentPrice(listingId: string, transaction: Transaction): Promise<PlanPriceHistoryModel | null> {
    return this.prices.findOne({ where: { planId: listingId, effectiveTo: null }, order: [['effectiveFrom', 'DESC']], transaction });
  }

  async adjustStock(listingId: string, reservedDelta: number, quantityDelta: number, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE directory.entity_plans
          SET stock_reserved = stock_reserved + :reservedDelta,
              stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity + :quantityDelta END,
              updated_at = now()
        WHERE id = :listingId`,
      { replacements: { listingId, reservedDelta, quantityDelta }, transaction },
    );
  }

  async openOrders(userId: string, transaction: Transaction): Promise<{ id: string; planId: string }[]> {
    return this.sequelize.query<{ id: string; planId: string }>(
      `SELECT id, plan_id AS "planId" FROM directory.payment_orders
        WHERE athlete_user_id = :userId AND status IN ('PENDING_PAYMENT', 'PENDING_VERIFICATION')`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
  }

  create(data: Partial<PaymentOrderModel>, transaction: Transaction): Promise<PaymentOrderModel> {
    return this.orders.create(data as never, { transaction });
  }

  /** The order row-locked. Two confirmations (or a confirmation and an expiry) queue here. */
  lockOrder(orderId: string, transaction: Transaction): Promise<PaymentOrderModel | null> {
    return this.orders.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
  }

  findOrder(orderId: string, transaction?: Transaction): Promise<PaymentOrderModel | null> {
    return this.orders.findByPk(orderId, { transaction });
  }

  async update(order: PaymentOrderModel, patch: Partial<PaymentOrderModel>, transaction: Transaction): Promise<void> {
    await order.update(patch, { transaction });
  }

  /** Append-only history; the timeline the buyer and the business read. */
  async recordTransition(
    input: { orderId: string; from: PaymentOrderStatus | null; to: PaymentOrderStatus; actorUserId: string | null; reasonCode: string | null },
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO directory.payment_order_history (order_id, from_status, to_status, actor_user_id, reason_code)
       VALUES (:orderId, :from, :to, :actorUserId, :reasonCode)`,
      { replacements: input, transaction },
    );
  }

  history(orderId: string): Promise<OrderHistoryRow[]> {
    return this.sequelize.query<OrderHistoryRow>(
      `SELECT hst.from_status AS "fromStatus", hst.to_status AS "toStatus", hst.reason_code AS "reasonCode", hst.at,
              (hst.actor_user_id IS NOT NULL AND hst.actor_user_id = o.athlete_user_id) AS "byBuyer",
              (hst.actor_user_id IS NULL) AS "bySystem"
         FROM directory.payment_order_history hst
         JOIN directory.payment_orders o ON o.id = hst.order_id
        WHERE hst.order_id = :orderId
        ORDER BY hst.at, hst.id`,
      { type: QueryTypes.SELECT, replacements: { orderId } },
    );
  }

  /** One order as a list row, scoped to its buyer or to its seller: anyone else's is never found. */
  async findRow(scope: Scope, orderId: string): Promise<OrderListRow | null> {
    const [row] = await this.sequelize.query<OrderListRow>(
      `${listSelect(scope)} WHERE o.id = :orderId AND ${'buyerId' in scope ? 'o.athlete_user_id = :owner' : 'o.entity_id = :owner'}`,
      { type: QueryTypes.SELECT, replacements: { orderId, owner: 'buyerId' in scope ? scope.buyerId : scope.entityId } },
    );
    return row ?? null;
  }

  /** "Por confirmar" of a business: the badge of the inbox. */
  async countPending(entityId: string): Promise<number> {
    const [row] = await this.sequelize.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM directory.payment_orders WHERE entity_id = :entityId AND status = 'PENDING_VERIFICATION'`,
      { type: QueryTypes.SELECT, replacements: { entityId } },
    );
    return row?.count ?? 0;
  }

  /** A keyset page (`ix_payment_orders_entity_status`, `ix_payment_orders_athlete`). */
  list(
    scope: Scope,
    filter: { status?: PaymentOrderStatus },
    after: OrderKeyset | null,
    limit: number,
  ): Promise<OrderListRow[]> {
    const where = ['buyerId' in scope ? 'o.athlete_user_id = :owner' : 'o.entity_id = :owner'];
    if (filter.status) where.push('o.status = :status');
    // Both values come from a validated cursor (bucket digit, decimal) and are bound, never inlined.
    const { bucket, sort } = order(scope);
    if (after) where.push(`(${bucket}, ${sort}, o.id) > (:bucket, CAST(:sortKey AS numeric), CAST(:afterId AS uuid))`);
    return this.sequelize.query<OrderListRow>(
      `${listSelect(scope)} WHERE ${where.join(' AND ')} ORDER BY ${bucket}, ${sort}, o.id LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          owner: 'buyerId' in scope ? scope.buyerId : scope.entityId,
          status: filter.status ?? null,
          bucket: after?.bucket ?? 0,
          sortKey: after?.sortKey ?? '0',
          afterId: after?.id ?? null,
          limit,
        },
      },
    );
  }
}

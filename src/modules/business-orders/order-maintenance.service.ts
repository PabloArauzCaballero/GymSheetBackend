import { Injectable, Logger } from '@nestjs/common';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env';
import { PaymentOrderModel } from '../directory/models/payment-order.model';
import { OrderLifecycle } from './order-lifecycle.service';
import { OrderNotices, orderRef } from './order-notices';
import { OrdersRepository } from './orders.repository';
import { SellersRepository } from './sellers.repository';

export type OrdersMaintenanceResult = { expired: number; cancelled: number; reminded: number; failed: number };

/** Not paid yet: a QR order waiting for its receipt, or a cash order waiting for the visit. */
const UNPAID = `(o.status = 'PENDING_PAYMENT' OR (o.status = 'PENDING_VERIFICATION' AND o.method = 'CASH'))`;

const DUE_SQL = `SELECT o.id FROM directory.payment_orders o
                  WHERE ${UNPAID} AND o.expires_at <= now() ORDER BY o.expires_at LIMIT :limit`;
const UNAVAILABLE_SQL = `SELECT o.id FROM directory.payment_orders o JOIN directory.entities e ON e.id = o.entity_id
                          WHERE ${UNPAID} AND e.status <> 'ACTIVE' ORDER BY o.created_at LIMIT :limit`;
const REMIND_SQL = `SELECT o.id FROM directory.payment_orders o
                     WHERE o.status = 'PENDING_VERIFICATION' AND o.method = 'QR' AND o.reminders_sent < 2
                       AND o.submitted_at <= now() - make_interval(hours => CASE o.reminders_sent WHEN 0 THEN :first ELSE :second END)
                     ORDER BY o.submitted_at LIMIT :limit`;

/**
 * The deadlines of the orders (ADR-0024), one pass at a time for
 * `worker:orders-maintenance`:
 * - an unpaid order past its deadline expires and frees its stock;
 * - an unpaid order of a seller that stopped being public (suspended, paused,
 *   closed) is cancelled, and the buyer is told not to pay;
 * - a receipt waiting for the business gets a reminder to it at 24 h and 48 h.
 * Each order moves in its own transaction under its row lock, re-checked
 * there: a confirmation or a receipt that arrived first wins.
 */
@Injectable()
export class OrderMaintenanceService {
  private readonly logger = new Logger(OrderMaintenanceService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: OrdersRepository,
    private readonly sellers: SellersRepository,
    private readonly lifecycle: OrderLifecycle,
    private readonly notices: OrderNotices,
  ) {}

  async runOnce(limit: number = env.ORDERS_MAINTENANCE_BATCH_SIZE, now: () => Date = () => new Date()): Promise<OrdersMaintenanceResult> {
    const result: OrdersMaintenanceResult = { expired: 0, cancelled: 0, reminded: 0, failed: 0 };
    const replacements = { limit, first: env.ORDER_VERIFICATION_FIRST_REMINDER_HOURS, second: env.ORDER_VERIFICATION_SECOND_REMINDER_HOURS };
    const pass = async (sql: string, step: (order: PaymentOrderModel, transaction: Transaction) => Promise<boolean>, key: keyof OrdersMaintenanceResult) => {
      const ids = await this.sequelize.query<{ id: string }>(sql, { type: QueryTypes.SELECT, replacements });
      for (const { id } of ids) {
        try {
          const moved = await this.repository.transaction(async (transaction) => {
            const order = await this.repository.lockOrder(id, transaction);
            return order ? step(order, transaction) : false;
          });
          if (moved) result[key] += 1;
        } catch (error: unknown) {
          // One order that fails never holds back the rest; the next pass retries it.
          result.failed += 1;
          this.logger.error({ event: 'orders_maintenance.order_failed', step: key, errorName: error instanceof Error ? error.name : 'UnknownError' });
        }
      }
    };
    await pass(UNAVAILABLE_SQL, (order, transaction) => this.cancelUnavailable(order, transaction), 'cancelled');
    await pass(DUE_SQL, (order, transaction) => this.expire(order, now(), transaction), 'expired');
    await pass(REMIND_SQL, (order, transaction) => this.remind(order, now(), transaction), 'reminded');
    return result;
  }

  private unpaid(order: PaymentOrderModel): boolean {
    return order.status === 'PENDING_PAYMENT' || (order.status === 'PENDING_VERIFICATION' && order.method === 'CASH');
  }

  private async expire(order: PaymentOrderModel, now: Date, transaction: Transaction): Promise<boolean> {
    if (!this.unpaid(order) || !order.expiresAt || order.expiresAt > now) return false;
    await this.lifecycle.close(order, 'EXPIRED', { actorUserId: null, reasonCode: 'EXPIRED', patch: { cancelledAt: now, cancelReason: 'EXPIRED' } }, transaction);
    await this.notices.send(order.athleteUserId, orderRef(order), { kind: 'EXPIRED' }, transaction);
    return true;
  }

  private async cancelUnavailable(order: PaymentOrderModel, transaction: Transaction): Promise<boolean> {
    const seller = await this.sellers.findSeller(order.entityId, transaction);
    if (!this.unpaid(order) || seller?.entityStatus === 'ACTIVE') return false;
    await this.lifecycle.close(
      order,
      'CANCELLED',
      { actorUserId: null, reasonCode: 'BUSINESS_UNAVAILABLE', patch: { cancelledAt: new Date(), cancelReason: 'BUSINESS_UNAVAILABLE' } },
      transaction,
    );
    await this.notices.send(order.athleteUserId, orderRef(order), { kind: 'BUSINESS_UNAVAILABLE' }, transaction);
    return true;
  }

  private async remind(order: PaymentOrderModel, now: Date, transaction: Transaction): Promise<boolean> {
    if (order.status !== 'PENDING_VERIFICATION' || order.method !== 'QR' || !order.submittedAt || order.remindersSent >= 2) return false;
    const hours = (now.getTime() - order.submittedAt.getTime()) / 3_600_000;
    const level = hours >= env.ORDER_VERIFICATION_SECOND_REMINDER_HOURS ? 2 : hours >= env.ORDER_VERIFICATION_FIRST_REMINDER_HOURS ? 1 : 0;
    if (level <= order.remindersSent) return false;
    await this.repository.update(order, { remindersSent: level }, transaction);
    const seller = await this.sellers.findSeller(order.entityId, transaction);
    await this.notices.send(seller?.ownerUserId ?? null, orderRef(order), { kind: 'VERIFICATION_REMINDER', level, attempt: order.receiptAttempts }, transaction);
    return true;
  }
}

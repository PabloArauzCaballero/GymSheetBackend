import { HttpStatus, Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { PaymentOrderModel, PaymentOrderStatus } from '../directory/models/payment-order.model';
import { OrdersRepository } from './orders.repository';

type Closing = 'REJECTED' | 'CANCELLED' | 'EXPIRED';

/**
 * Every status change of an order goes through here, under the order's row
 * lock, so the stock it holds and the append-only history can never drift
 * from its status: a closing order returns its units, a confirmed one
 * consumes them, and each change leaves its history row.
 */
@Injectable()
export class OrderLifecycle {
  constructor(private readonly repository: OrdersRepository) {}

  /**
   * Units of a product held for an order, under the listing's row lock. A
   * listing without stock control (`stock_quantity` null) reserves nothing.
   */
  async reserve(listing: EntityPlanModel, quantity: number, transaction: Transaction): Promise<number> {
    if (listing.stockQuantity === null) return 0;
    const available = listing.stockQuantity - listing.stockReserved;
    if (quantity > available) {
      throw new DomainException(HttpStatus.CONFLICT, 'ORDER_OUT_OF_STOCK', 'No quedan suficientes unidades.', { available: Math.max(available, 0) });
    }
    await this.repository.adjustStock(listing.id, quantity, 0, transaction);
    return quantity;
  }

  async close(
    order: PaymentOrderModel,
    to: Closing,
    input: { actorUserId: string | null; reasonCode: string | null; patch: Partial<PaymentOrderModel> },
    transaction: Transaction,
  ): Promise<void> {
    if (order.stockReservedUnits > 0) await this.repository.adjustStock(order.planId, -order.stockReservedUnits, 0, transaction);
    await this.move(order, to, { ...input.patch, stockReservedUnits: 0 }, input, transaction);
  }

  /** The reserved units leave the stock for good. */
  async confirm(order: PaymentOrderModel, actorUserId: string, membershipId: string | null, transaction: Transaction): Promise<void> {
    const units = order.stockReservedUnits;
    if (units > 0) await this.repository.adjustStock(order.planId, -units, -units, transaction);
    await this.move(
      order,
      'CONFIRMED',
      { stockReservedUnits: 0, decidedByUserId: actorUserId, decidedAt: new Date(), membershipId, rejectionCode: null, rejectionReason: null },
      { actorUserId, reasonCode: null },
      transaction,
    );
  }

  async move(
    order: PaymentOrderModel,
    to: PaymentOrderStatus,
    patch: Partial<PaymentOrderModel>,
    input: { actorUserId: string | null; reasonCode: string | null },
    transaction: Transaction,
  ): Promise<void> {
    const from = order.status;
    await this.repository.update(order, { ...patch, status: to }, transaction);
    await this.repository.recordTransition({ orderId: order.id, from, to, actorUserId: input.actorUserId, reasonCode: input.reasonCode }, transaction);
  }
}

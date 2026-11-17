import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { PaymentOrderModel } from '../directory/models/payment-order.model';
import { OrderListQuery, RejectOrderInput } from './business-orders.schemas';
import { invalidTransition } from './order.catalog';
import { decodeOrderCursor, encodeOrderCursor } from './order-cursor';
import { OrderLifecycle } from './order-lifecycle.service';
import { OrderMembershipBridge } from './order-membership-bridge';
import { OrderNotices, orderRef } from './order-notices';
import { OrderPaymentService } from './order-payment.service';
import { BusinessOrderDto, TimelineEntryDto, mapBusinessOrder, mapTimeline } from './orders.mapper';
import { OrdersRepository } from './orders.repository';

/**
 * The business's inbox (ADR-0024, `business/me/orders*`): the account that
 * owns the listing confirms or rejects; nobody else, REPP included (D9). Every
 * query is scoped to the account's entity, so another business's order is 404.
 * A suspended business still decides what was already paid (plan §2.7).
 */
@Injectable()
export class BusinessOrdersService {
  constructor(
    private readonly accounts: BusinessAccountsRepository,
    private readonly repository: OrdersRepository,
    private readonly lifecycle: OrderLifecycle,
    private readonly bridge: OrderMembershipBridge,
    private readonly notices: OrderNotices,
    private readonly payment: OrderPaymentService,
  ) {}

  async list(actor: AuthenticatedUser, query: OrderListQuery): Promise<{ items: BusinessOrderDto[]; nextCursor: string | null; pendingCount: number }> {
    const entityId = await this.entityOf(actor);
    const [rows, pendingCount] = await Promise.all([
      this.repository.list({ entityId }, { status: query.status }, decodeOrderCursor(query.cursor), query.limit + 1),
      this.repository.countPending(entityId),
    ]);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return { items: page.map(mapBusinessOrder), nextCursor: rows.length > query.limit && last ? encodeOrderCursor(last) : null, pendingCount };
  }

  async get(actor: AuthenticatedUser, orderId: string): Promise<BusinessOrderDto & { timeline: TimelineEntryDto[] }> {
    const row = await this.repository.findRow({ entityId: await this.entityOf(actor) }, orderId);
    if (!row) throw new NotFoundException('Pedido no encontrado.');
    return { ...mapBusinessOrder(row), timeline: mapTimeline(await this.repository.history(orderId)) };
  }

  async receipt(actor: AuthenticatedUser, orderId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const order = await this.repository.findOrder(orderId);
    if (!order || order.entityId !== (await this.entityOf(actor))) throw new NotFoundException('Pedido no encontrado.');
    return this.payment.readReceipt(order);
  }

  /** Row-locked: of two confirmations at once, one wins and the other is 409; a replay is 409 too. */
  async confirm(actor: AuthenticatedUser, orderId: string): Promise<BusinessOrderDto> {
    const entityId = await this.entityOf(actor);
    await this.repository.transaction(async (transaction) => {
      const order = await this.lockOwn(entityId, orderId, transaction);
      if (order.status !== 'PENDING_VERIFICATION') throw invalidTransition(order.status);
      const membershipId = await this.bridge.activate(order, actor.id, transaction);
      await this.lifecycle.confirm(order, actor.id, membershipId, transaction);
      await this.notices.send(order.athleteUserId, orderRef(order), { kind: 'CONFIRMED' }, transaction);
    });
    return this.get(actor, orderId);
  }

  async reject(actor: AuthenticatedUser, orderId: string, input: RejectOrderInput): Promise<BusinessOrderDto> {
    if (input.reasonCode === 'OTHER' && !input.note) {
      throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'ORDER_REJECTION_NOTE_REQUIRED', 'Explica el motivo para que la persona sepa qué corregir.');
    }
    const entityId = await this.entityOf(actor);
    await this.repository.transaction(async (transaction) => {
      const order = await this.lockOwn(entityId, orderId, transaction);
      if (order.status !== 'PENDING_VERIFICATION') throw invalidTransition(order.status);
      await this.lifecycle.close(
        order,
        'REJECTED',
        {
          actorUserId: actor.id,
          reasonCode: input.reasonCode,
          patch: { rejectionCode: input.reasonCode, rejectionReason: input.note ?? null, decidedByUserId: actor.id, decidedAt: new Date() },
        },
        transaction,
      );
      await this.notices.send(
        order.athleteUserId,
        orderRef(order),
        { kind: 'REJECTED', code: input.reasonCode, note: input.note ?? null, attempt: order.receiptAttempts },
        transaction,
      );
    });
    return this.get(actor, orderId);
  }

  private async entityOf(actor: AuthenticatedUser): Promise<string> {
    const account = await this.accounts.findByUserId(actor.id);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    return account.entityId;
  }

  private async lockOwn(entityId: string, orderId: string, transaction: Transaction): Promise<PaymentOrderModel> {
    const order = await this.repository.lockOrder(orderId, transaction);
    if (!order || order.entityId !== entityId) throw new NotFoundException('Pedido no encontrado.');
    return order;
  }
}

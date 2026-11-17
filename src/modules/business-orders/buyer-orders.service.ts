import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { PaymentOrderModel } from '../directory/models/payment-order.model';
import { CreateOrderInput, OrderListQuery } from './business-orders.schemas';
import { buyerMayCancel, invalidTransition, orderNumber } from './order.catalog';
import { decodeOrderCursor, encodeOrderCursor } from './order-cursor';
import { OrderLifecycle } from './order-lifecycle.service';
import { OrderNotices, orderRef } from './order-notices';
import { BuyerOrderDto, TimelineEntryDto, mapBuyerOrder, mapTimeline } from './orders.mapper';
import { OrdersRepository } from './orders.repository';
import { SellerRow, SellersRepository } from './sellers.repository';

const HOUR_MS = 3_600_000;

/** Total of `quantity` units, in cents: a price is never multiplied as a float. */
export function totalAmount(unit: string, quantity: number): string {
  const [whole, fraction = ''] = unit.split('.');
  const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))) * BigInt(quantity);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function listingNotFound(): NotFoundException {
  return new NotFoundException('Publicación no encontrada.');
}

/**
 * The buyer's side of an order (ADR-0024): create one for a public listing,
 * read "Mis compras" and the timeline, and cancel what has not been paid.
 * Someone else's order is never found (404).
 */
@Injectable()
export class BuyerOrdersService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly sellers: SellersRepository,
    private readonly lifecycle: OrderLifecycle,
    private readonly notices: OrderNotices,
  ) {}

  async create(actor: AuthenticatedUser, input: CreateOrderInput): Promise<BuyerOrderDto> {
    const orderId = await this.repository.transaction(async (transaction) => {
      await this.repository.lockBuyer(actor.id, transaction);
      const listing = await this.repository.lockListing(input.listingId, transaction);
      const seller = listing ? await this.sellers.findSeller(listing.entityId, transaction) : null;
      // Only what is public is sold (ADR-0022): anything else answers as if it did not exist.
      if (!listing || !seller || listing.moderationStatus !== 'LIVE' || listing.status !== 'ACTIVE' || seller.entityStatus !== 'ACTIVE') {
        throw listingNotFound();
      }
      this.assertQuantity(listing, input.quantity);
      await this.assertMethod(seller, input.method, transaction);
      await this.assertOpenOrders(actor.id, listing.id, transaction);
      const price = await this.repository.findCurrentPrice(listing.id, transaction);
      if (!price) throw listingNotFound();
      const reserved = await this.lifecycle.reserve(listing, input.quantity, transaction);
      const now = new Date();
      const cash = input.method === 'CASH';
      const order = await this.repository.create(
        {
          orderNumber: orderNumber(now, randomBytes(4).toString('hex')),
          entityId: listing.entityId,
          planId: listing.id,
          athleteUserId: actor.id,
          priceHistoryId: price.id,
          // The price is the listing's, never the client's.
          unitAmount: listing.currentPrice,
          quantity: input.quantity,
          amount: totalAmount(listing.currentPrice, input.quantity),
          currency: listing.currency,
          planSnapshot: snapshotOf(listing),
          method: input.method,
          status: cash ? 'PENDING_VERIFICATION' : 'PENDING_PAYMENT',
          expiresAt: new Date(now.getTime() + (cash ? env.ORDER_CASH_TTL_HOURS : env.ORDER_PAYMENT_TTL_HOURS) * HOUR_MS),
          stockReservedUnits: reserved,
          athleteNotes: input.note ?? null,
        },
        transaction,
      );
      await this.repository.recordTransition({ orderId: order.id, from: null, to: order.status, actorUserId: actor.id, reasonCode: null }, transaction);
      if (cash) await this.notices.send(seller.ownerUserId, orderRef(order), { kind: 'NEW_CASH_ORDER' }, transaction);
      return order.id;
    });
    return this.get(actor, orderId);
  }

  async list(actor: AuthenticatedUser, query: OrderListQuery): Promise<{ items: BuyerOrderDto[]; nextCursor: string | null }> {
    const rows = await this.repository.list({ buyerId: actor.id }, { status: query.status }, decodeOrderCursor(query.cursor), query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return { items: page.map(mapBuyerOrder), nextCursor: rows.length > query.limit && last ? encodeOrderCursor(last) : null };
  }

  async get(actor: AuthenticatedUser, orderId: string): Promise<BuyerOrderDto & { timeline: TimelineEntryDto[] }> {
    const row = await this.repository.findRow({ buyerId: actor.id }, orderId);
    if (!row) throw new NotFoundException('Pedido no encontrado.');
    return { ...mapBuyerOrder(row), timeline: mapTimeline(await this.repository.history(orderId)) };
  }

  /** Waiting for payment, rejected, or a cash order not paid yet: the buyer walks away and the stock is freed. */
  async cancel(actor: AuthenticatedUser, orderId: string): Promise<BuyerOrderDto> {
    await this.repository.transaction(async (transaction) => {
      const order = await this.lockOwn(actor, orderId, transaction);
      if (!buyerMayCancel(order)) throw invalidTransition(order.status);
      await this.lifecycle.close(
        order,
        'CANCELLED',
        { actorUserId: actor.id, reasonCode: 'BUYER', patch: { cancelledAt: new Date(), cancelReason: 'BUYER' } },
        transaction,
      );
    });
    return this.get(actor, orderId);
  }

  async lockOwn(actor: AuthenticatedUser, orderId: string, transaction: Transaction): Promise<PaymentOrderModel> {
    const order = await this.repository.lockOrder(orderId, transaction);
    if (!order || order.athleteUserId !== actor.id) throw new NotFoundException('Pedido no encontrado.');
    return order;
  }

  private assertQuantity(listing: EntityPlanModel, quantity: number): void {
    if (quantity === 1) return;
    if (listing.offerKind !== 'PRODUCT' || quantity > env.ORDER_MAX_QUANTITY) {
      throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'ORDER_QUANTITY_NOT_ALLOWED', 'Solo los productos se piden por varias unidades.', {
        max: listing.offerKind === 'PRODUCT' ? env.ORDER_MAX_QUANTITY : 1,
      });
    }
  }

  private async assertMethod(seller: SellerRow, method: CreateOrderInput['method'], transaction: Transaction): Promise<void> {
    const config = await this.sellers.findConfig(seller.entityId, transaction);
    const available = Boolean(config?.isActive) && (method === 'QR' ? Boolean(config?.qrPrivateKey) : Boolean(config?.acceptsCash));
    if (!available) {
      throw new DomainException(HttpStatus.CONFLICT, 'ORDER_PAYMENT_METHOD_UNAVAILABLE', 'Este negocio no recibe pagos por ese medio ahora.', { method });
    }
  }

  /** Counted under the buyer's advisory lock: a double tap or parallel requests open one order, not two. */
  private async assertOpenOrders(userId: string, listingId: string, transaction: Transaction): Promise<void> {
    const open = await this.repository.openOrders(userId, transaction);
    const same = open.find((order) => order.planId === listingId);
    if (same) throw new DomainException(HttpStatus.CONFLICT, 'ORDER_ALREADY_OPEN', 'Ya tienes un pedido abierto de esta publicación.', { orderId: same.id });
    if (open.length >= env.ORDER_OPEN_MAX_PER_PERSON) {
      throw new DomainException(HttpStatus.CONFLICT, 'ORDER_OPEN_LIMIT', 'Tienes demasiados pedidos abiertos; termina o cancela alguno.', {
        max: env.ORDER_OPEN_MAX_PER_PERSON,
      });
    }
  }
}

/** What was offered at this exact moment: the order keeps it even if the listing changes later. */
function snapshotOf(listing: EntityPlanModel): Record<string, unknown> {
  return {
    id: listing.id,
    name: listing.name,
    offerKind: listing.offerKind,
    type: listing.type,
    description: listing.description,
    benefits: listing.benefits ?? [],
    validityDays: listing.durationDays,
    sessionsCount: listing.sessionsCount,
  };
}

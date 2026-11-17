import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { MediaReleaseService } from '../media/media-release.service';
import { UploadedSelfie } from '../verification/selfie-image';
import { ReceiptFields } from './business-orders.schemas';
import { BuyerOrdersService } from './buyer-orders.service';
import { OPEN_STATUSES, buyerMayUploadReceipt, invalidTransition } from './order.catalog';
import { OrderLifecycle } from './order-lifecycle.service';
import { OrderNotices, orderRef } from './order-notices';
import { BuyerOrderDto } from './orders.mapper';
import { OrdersRepository } from './orders.repository';
import { PaymentEvidenceStore } from './payment-evidence.store';
import { SellersRepository } from './sellers.repository';

function receiptLimit(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'ORDER_RECEIPT_LIMIT', 'Ya enviaste el máximo de comprobantes para este pedido.', {
    max: env.ORDER_RECEIPT_MAX_ATTEMPTS,
  });
}

export type PaymentInstructionsDto = {
  orderId: string;
  orderNumber: string;
  method: 'QR' | 'CASH';
  amount: string;
  currency: string;
  expiresAt: string | null;
  bankName: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
  aliasOrPhone: string | null;
  instructions: string | null;
  /** Path (under the API prefix) of the QR image, served only to this buyer; null for cash. */
  qrPath: string | null;
};

/**
 * Paying an order (ADR-0024): the seller's payment data and QR go only to the
 * buyer of an open order (they are no longer public, D5), and the receipt is
 * a private, encrypted file (D6), never a URL the client sends.
 */
@Injectable()
export class OrderPaymentService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly sellers: SellersRepository,
    private readonly buyers: BuyerOrdersService,
    private readonly lifecycle: OrderLifecycle,
    private readonly notices: OrderNotices,
    private readonly evidence: PaymentEvidenceStore,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  async instructions(actor: AuthenticatedUser, orderId: string): Promise<PaymentInstructionsDto> {
    const { order, config } = await this.payable(actor, orderId);
    const qr = order.method === 'QR';
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      method: order.method,
      amount: String(order.amount),
      currency: order.currency.trim(),
      expiresAt: order.expiresAt ? order.expiresAt.toISOString() : null,
      bankName: qr ? config.bankName : null,
      accountHolderName: qr ? config.accountHolderName : null,
      accountNumber: qr ? config.accountNumber : null,
      aliasOrPhone: qr ? config.aliasOrPhone : null,
      instructions: config.instructions,
      qrPath: qr && config.qrPrivateKey ? `/directory/payments/orders/${order.id}/payment-qr` : null,
    };
  }

  async paymentQr(actor: AuthenticatedUser, orderId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const { order, config } = await this.payable(actor, orderId);
    if (order.method !== 'QR' || !config.qrPrivateKey || !config.qrMime) throw new NotFoundException('QR no encontrado.');
    return { buffer: await this.evidence.read(config.qrPrivateKey), mimeType: config.qrMime };
  }

  /** The receipt, encrypted at rest; a resend after a rejection reserves the stock again. */
  async uploadReceipt(actor: AuthenticatedUser, orderId: string, file: UploadedSelfie | undefined, fields: ReceiptFields): Promise<BuyerOrderDto> {
    const before = await this.repository.findOrder(orderId);
    if (!before || before.athleteUserId !== actor.id) throw new NotFoundException('Pedido no encontrado.');
    if (!buyerMayUploadReceipt(before)) throw invalidTransition(before.status);
    // Checked before storing anything as well: a spent order must not turn into free encrypted storage.
    if (before.receiptAttempts >= env.ORDER_RECEIPT_MAX_ATTEMPTS) throw receiptLimit();
    const image = this.evidence.validate(file);
    const stored = await this.evidence.put(image, { category: 'order-receipt', orderId });
    try {
      await this.repository.transaction(async (transaction) => {
        const order = await this.buyers.lockOwn(actor, orderId, transaction);
        if (!buyerMayUploadReceipt(order)) throw invalidTransition(order.status);
        // A seller that stopped being public (suspended, paused, closed) receives no payment (ADR-0028 hardening).
        if ((await this.sellers.findSeller(order.entityId, transaction))?.entityStatus !== 'ACTIVE') throw businessUnavailable();
        if (order.receiptAttempts >= env.ORDER_RECEIPT_MAX_ATTEMPTS) throw receiptLimit();
        let reserved = order.stockReservedUnits;
        if (order.status === 'REJECTED') {
          const listing = await this.repository.lockListing(order.planId, transaction);
          if (!listing) throw new NotFoundException('Pedido no encontrado.');
          reserved = await this.lifecycle.reserve(listing, order.quantity, transaction);
        }
        const previous = order.receiptPrivateKey;
        await this.lifecycle.move(
          order,
          'PENDING_VERIFICATION',
          {
            receiptPrivateKey: stored.key,
            receiptMime: stored.mime,
            receiptSha256: stored.sha256,
            receiptReference: fields.reference ?? null,
            receiptAttempts: order.receiptAttempts + 1,
            submittedAt: new Date(),
            expiresAt: null,
            remindersSent: 0,
            stockReservedUnits: reserved,
            rejectionCode: null,
            rejectionReason: null,
          },
          { actorUserId: actor.id, reasonCode: null },
          transaction,
        );
        // Only the latest receipt is kept; the replaced file is deleted for real (ADR-0017).
        if (previous) await this.mediaRelease.requestRelease({ aggregateType: 'directory.payment_order', aggregateId: order.id, storageKey: previous }, transaction);
        const seller = await this.sellers.findSeller(order.entityId, transaction);
        await this.notices.send(seller?.ownerUserId ?? null, orderRef(order), { kind: 'RECEIPT_RECEIVED', attempt: order.receiptAttempts }, transaction);
      });
    } catch (error: unknown) {
      await this.evidence.discard(stored.key);
      throw error;
    }
    return this.buyers.get(actor, orderId);
  }

  async ownReceipt(actor: AuthenticatedUser, orderId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const order = await this.repository.findOrder(orderId);
    if (!order || order.athleteUserId !== actor.id) throw new NotFoundException('Pedido no encontrado.');
    return this.readReceipt(order);
  }

  async readReceipt(order: { receiptPrivateKey: string | null; receiptMime: string | null }): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!order.receiptPrivateKey || !order.receiptMime) throw new NotFoundException('Comprobante no encontrado.');
    return { buffer: await this.evidence.read(order.receiptPrivateKey), mimeType: order.receiptMime };
  }

  /**
   * An open order of this buyer whose seller is still public. A suspended or
   * paused seller answers 409 ORDER_BUSINESS_UNAVAILABLE: the buyer is told
   * not to pay instead of being shown the QR.
   */
  private async payable(actor: AuthenticatedUser, orderId: string) {
    const order = await this.repository.findOrder(orderId);
    if (!order || order.athleteUserId !== actor.id) throw new NotFoundException('Pedido no encontrado.');
    if (!OPEN_STATUSES.includes(order.status) && order.status !== 'REJECTED') throw invalidTransition(order.status);
    const seller = await this.sellers.findSeller(order.entityId);
    if (seller?.entityStatus !== 'ACTIVE') throw businessUnavailable();
    const config = await this.sellers.findConfig(order.entityId);
    if (!config?.isActive) {
      throw new DomainException(HttpStatus.CONFLICT, 'ORDER_PAYMENT_METHOD_UNAVAILABLE', 'Este negocio no recibe pagos ahora.', { method: order.method });
    }
    return { order, config };
  }
}

function businessUnavailable(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'ORDER_BUSINESS_UNAVAILABLE', 'Este negocio no está disponible: no hagas ningún pago.');
}

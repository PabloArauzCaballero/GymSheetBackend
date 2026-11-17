import { Injectable, Logger } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { NotificationChannel } from '../../common/enums/domain.enums';
import { NotificationService } from '../notifications/notification.service';
import { REJECTION_TEXT, RejectionCode } from './order.catalog';

type OrderRef = { id: string; orderNumber: string; listingName: string; amount: string; currency: string };

export type OrderNotice =
  | { kind: 'NEW_CASH_ORDER' }
  | { kind: 'RECEIPT_RECEIVED'; attempt: number }
  | { kind: 'VERIFICATION_REMINDER'; level: number; attempt: number }
  | { kind: 'CONFIRMED' }
  | { kind: 'REJECTED'; code: RejectionCode; note: string | null; attempt: number }
  | { kind: 'EXPIRED' }
  | { kind: 'BUSINESS_UNAVAILABLE' };

function render(order: OrderRef, notice: OrderNotice): { subject: string; body: string; dedup: string } {
  const what = `«${order.listingName}» (${order.amount} ${order.currency.trim()})`;
  switch (notice.kind) {
    case 'NEW_CASH_ORDER':
      return { subject: `Nuevo pedido en efectivo · ${order.orderNumber}`, body: `Te pidieron ${what} para pagar en efectivo. Confírmalo cuando recibas el pago.`, dedup: 'new' };
    case 'RECEIPT_RECEIVED':
      return { subject: `Comprobante recibido · ${order.orderNumber}`, body: `Te enviaron el comprobante de ${what}. Revisa que el pago llegó y confirma o rechaza el pedido.`, dedup: `receipt:${notice.attempt}` };
    case 'VERIFICATION_REMINDER':
      return { subject: `Pedido por confirmar · ${order.orderNumber}`, body: `Un comprobante de ${what} espera tu decisión. Quien pagó está esperando: confírmalo o recházalo.`, dedup: `reminder:${notice.attempt}:${notice.level}` };
    case 'CONFIRMED':
      return { subject: `Pedido confirmado · ${order.orderNumber}`, body: `El negocio confirmó tu pago de ${what}.`, dedup: 'confirmed' };
    case 'REJECTED':
      return {
        subject: `Pedido observado · ${order.orderNumber}`,
        body: `${REJECTION_TEXT[notice.code]}${notice.note ? ` «${notice.note}».` : ''} Puedes enviar otro comprobante o escribirle al negocio.`,
        dedup: `rejected:${notice.attempt}`,
      };
    case 'EXPIRED':
      return { subject: `Pedido vencido · ${order.orderNumber}`, body: `Tu pedido de ${what} venció sin pago. Si todavía lo quieres, haz un pedido nuevo.`, dedup: 'expired' };
    case 'BUSINESS_UNAVAILABLE':
      return { subject: `Pedido cancelado · ${order.orderNumber}`, body: `El negocio ya no está disponible en REPP y cancelamos tu pedido de ${what}. No hagas ningún pago.`, dedup: 'unavailable' };
  }
}

/** In-app notices of the orders (plan §2.12). A notice that fails never undoes the order change it reports. */
@Injectable()
export class OrderNotices {
  private readonly logger = new Logger(OrderNotices.name);

  constructor(private readonly notifications: NotificationService) {}

  async send(recipientUserId: string | null, order: OrderRef, notice: OrderNotice, transaction: Transaction): Promise<void> {
    if (!recipientUserId) return;
    const { subject, body, dedup } = render(order, notice);
    try {
      // Its own savepoint (inside the service): a failure rolls back the notice only.
      await this.notifications.enqueueDirectMessage(
        {
          recipientUserId,
          channel: NotificationChannel.IN_APP,
          subject,
          body,
          deduplicationKey: `payment-order:${order.id}:${dedup}`,
          metadata: { kind: 'PAYMENT_ORDER', event: notice.kind, orderId: order.id },
        },
        transaction,
      );
    } catch (error: unknown) {
      this.logger.warn({ event: 'payment_order.notice_failed', notice: notice.kind, errorName: error instanceof Error ? error.name : 'UnknownError' });
    }
  }
}

export function orderRef(order: { id: string; orderNumber: string; amount: string; currency: string; planSnapshot: Record<string, unknown> }): OrderRef {
  const name = order.planSnapshot?.name;
  return { id: order.id, orderNumber: order.orderNumber, amount: String(order.amount), currency: order.currency, listingName: typeof name === 'string' ? name : 'tu pedido' };
}

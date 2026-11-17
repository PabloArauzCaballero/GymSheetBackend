import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { PaymentOrderMethod, PaymentOrderStatus } from '../directory/models/payment-order.model';

/** Why the business rejects a receipt (the chips of the business inbox, plan §4.2). */
export const REJECTION_CODES = ['AMOUNT_MISMATCH', 'UNREADABLE', 'NOT_RECEIVED', 'OTHER'] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const REJECTION_TEXT: Record<RejectionCode, string> = {
  AMOUNT_MISMATCH: 'El monto del comprobante no coincide con el pedido.',
  UNREADABLE: 'No se puede leer el comprobante.',
  NOT_RECEIVED: 'El negocio no recibió el pago.',
  OTHER: 'El negocio observó el pago.',
};

export type CancelReason = 'BUYER' | 'BUSINESS_UNAVAILABLE' | 'EXPIRED' | 'BUSINESS_CLOSED';

export const ORDER_METHODS = ['QR', 'CASH'] as const satisfies readonly PaymentOrderMethod[];

/** Orders that still hold stock and can still change: waiting for payment or for the business. */
export const OPEN_STATUSES: readonly PaymentOrderStatus[] = ['PENDING_PAYMENT', 'PENDING_VERIFICATION'];

/**
 * What the buyer may do with an order in each state. A QR order already paid
 * (waiting for the business) is not cancelled by the buyer: the money moved
 * and the business decides. A cash order has not been paid yet, so it is.
 */
export function buyerMayCancel(order: { status: PaymentOrderStatus; method: PaymentOrderMethod }): boolean {
  if (order.status === 'PENDING_PAYMENT' || order.status === 'REJECTED') return true;
  return order.status === 'PENDING_VERIFICATION' && order.method === 'CASH';
}

/** A receipt goes on a QR order waiting for payment, or again after the business rejected one. */
export function buyerMayUploadReceipt(order: { status: PaymentOrderStatus; method: PaymentOrderMethod }): boolean {
  return order.method === 'QR' && (order.status === 'PENDING_PAYMENT' || order.status === 'REJECTED');
}

export function invalidTransition(status: PaymentOrderStatus): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'ORDER_INVALID_TRANSITION', 'El pedido no está en un estado que lo permita.', { status });
}

/** `GS-ORD-<time>-<random>`: unique by the column's constraint; the random part is not a secret. */
export function orderNumber(now: Date, random: string): string {
  return `GS-ORD-${now.getTime().toString(36).toUpperCase()}-${random.toUpperCase()}`;
}

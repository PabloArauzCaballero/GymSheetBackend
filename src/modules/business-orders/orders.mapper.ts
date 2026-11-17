import { resolveMediaUrl } from '../../common/media/media-url';
import { buyerMayCancel, buyerMayUploadReceipt, REJECTION_TEXT, RejectionCode } from './order.catalog';
import { OrderHistoryRow, OrderListRow } from './orders.repository';

type ListingSnapshotDto = { id: string | null; name: string; offerKind: string | null; validityDays: number | null; sessionsCount: number | null };

/** What both sides see of an order. No storage key, no hash, no internal ids beyond the entity. */
export type OrderDto = {
  id: string;
  orderNumber: string;
  status: string;
  method: 'QR' | 'CASH';
  quantity: number;
  unitAmount: string;
  amount: string;
  currency: string;
  listing: ListingSnapshotDto;
  seller: { entityId: string; name: string; handle: string | null; logoUrl: string | null };
  expiresAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  rejection: { code: string; text: string; note: string | null } | null;
  receipt: { uploaded: boolean; reference: string | null };
  /** What the buyer wrote with the order (a size, a time to pick it up); delivery is agreed by chat. */
  note: string | null;
  createdAt: string;
};

export type BuyerOrderDto = OrderDto & { actions: { canUploadReceipt: boolean; canCancel: boolean; canReport: boolean } };
export type BusinessOrderDto = OrderDto & { buyer: { name: string }; actions: { canDecide: boolean } };
export type TimelineEntryDto = { status: string; at: string; reasonCode: string | null; by: 'BUYER' | 'BUSINESS' | 'SYSTEM' };

const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null);

function snapshotOf(snapshot: Record<string, unknown>): ListingSnapshotDto {
  const text = (key: string) => {
    const value = snapshot[key];
    return typeof value === 'string' ? value : null;
  };
  const count = (key: string) => {
    const value = snapshot[key];
    return typeof value === 'number' ? value : null;
  };
  return {
    id: text('id'),
    name: text('name') ?? 'Publicación',
    offerKind: text('offerKind'),
    validityDays: count('validityDays') ?? count('durationDays'),
    sessionsCount: count('sessionsCount'),
  };
}

function base(row: OrderListRow): OrderDto {
  const code = row.rejectionCode as RejectionCode | null;
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    method: row.method,
    quantity: row.quantity,
    unitAmount: String(row.unitAmount),
    amount: String(row.amount),
    currency: row.currency.trim(),
    listing: snapshotOf(row.planSnapshot ?? {}),
    seller: { entityId: row.entityId, name: row.sellerName, handle: row.sellerHandle, logoUrl: resolveMediaUrl(row.sellerLogoUrl) },
    expiresAt: iso(row.expiresAt),
    submittedAt: iso(row.submittedAt),
    decidedAt: iso(row.decidedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    rejection: row.status === 'REJECTED' && code ? { code, text: REJECTION_TEXT[code] ?? REJECTION_TEXT.OTHER, note: row.rejectionReason } : null,
    receipt: { uploaded: row.hasReceipt, reference: row.receiptReference },
    note: row.buyerNote,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export function mapBuyerOrder(row: OrderListRow): BuyerOrderDto {
  return {
    ...base(row),
    actions: {
      canUploadReceipt: buyerMayUploadReceipt(row),
      canCancel: buyerMayCancel(row),
      // A dispute is about money that may have moved: not before a receipt or a cash order exists.
      canReport: row.status !== 'PENDING_PAYMENT',
    },
  };
}

export function mapBusinessOrder(row: OrderListRow): BusinessOrderDto {
  return { ...base(row), buyer: { name: row.buyerName }, actions: { canDecide: row.status === 'PENDING_VERIFICATION' } };
}

export function mapTimeline(rows: OrderHistoryRow[]): TimelineEntryDto[] {
  return rows.map((row) => ({
    status: row.toStatus,
    at: new Date(row.at).toISOString(),
    reasonCode: row.reasonCode,
    by: row.bySystem ? 'SYSTEM' : row.byBuyer ? 'BUYER' : 'BUSINESS',
  }));
}

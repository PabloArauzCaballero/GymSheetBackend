import { DomainException } from '../../common/errors/domain.exception';
import { totalAmount } from './buyer-orders.service';
import { buyerMayCancel, buyerMayUploadReceipt } from './order.catalog';
import { decodeOrderCursor, encodeOrderCursor } from './order-cursor';
import { HOLDER_MATCH_THRESHOLD, holderMatchOf } from './payment-config.service';

describe('order rules (ADR-0024)', () => {
  it('multiplies the unit price in cents, never as a float', () => {
    expect(totalAmount('120.50', 2)).toBe('241.00');
    expect(totalAmount('0.10', 3)).toBe('0.30');
    expect(totalAmount('19.99', 7)).toBe('139.93');
    expect(totalAmount('250', 1)).toBe('250.00');
  });

  it('a QR order paid and waiting for the business is not cancelled by the buyer; an unpaid or cash one is', () => {
    expect(buyerMayCancel({ status: 'PENDING_PAYMENT', method: 'QR' })).toBe(true);
    expect(buyerMayCancel({ status: 'PENDING_VERIFICATION', method: 'QR' })).toBe(false);
    expect(buyerMayCancel({ status: 'PENDING_VERIFICATION', method: 'CASH' })).toBe(true);
    expect(buyerMayCancel({ status: 'REJECTED', method: 'QR' })).toBe(true);
    for (const status of ['CONFIRMED', 'CANCELLED', 'EXPIRED'] as const) expect(buyerMayCancel({ status, method: 'QR' })).toBe(false);
  });

  it('a receipt goes only on a QR order waiting for payment or rejected', () => {
    expect(buyerMayUploadReceipt({ status: 'PENDING_PAYMENT', method: 'QR' })).toBe(true);
    expect(buyerMayUploadReceipt({ status: 'REJECTED', method: 'QR' })).toBe(true);
    expect(buyerMayUploadReceipt({ status: 'PENDING_VERIFICATION', method: 'QR' })).toBe(false);
    expect(buyerMayUploadReceipt({ status: 'PENDING_PAYMENT', method: 'CASH' })).toBe(false);
    expect(buyerMayUploadReceipt({ status: 'EXPIRED', method: 'QR' })).toBe(false);
  });

  it('the list cursor round-trips with microseconds and a tampered one is a 400', () => {
    const row = { bucket: 1, sortKey: '-1763400000.123456', id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff' };
    expect(decodeOrderCursor(encodeOrderCursor(row))).toEqual(row);
    expect(decodeOrderCursor(undefined)).toBeNull();
    for (const raw of ['2|1|6f9619ff-8b86-4d01-b42d-00cf4fc964ff', "0|1);DROP|6f9619ff-8b86-4d01-b42d-00cf4fc964ff", '0|1|x', '0|1|6f9619ff-8b86-4d01-b42d-00cf4fc964ff|y']) {
      expect(() => decodeOrderCursor(Buffer.from(raw).toString('base64url'))).toThrow(DomainException);
    }
  });

  it('the holder matches at 0.6 or more; without an approved KYC it is UNKNOWN, never a block', () => {
    expect(HOLDER_MATCH_THRESHOLD).toBe(0.6);
    expect(holderMatchOf(0.6)).toBe('PASS');
    expect(holderMatchOf(0.59)).toBe('WARN');
    expect(holderMatchOf(null)).toBe('UNKNOWN');
  });
});

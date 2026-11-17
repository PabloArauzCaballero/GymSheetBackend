import { NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { BusinessOrdersService } from './business-orders.service';
import { OrderLifecycle } from './order-lifecycle.service';
import { SubscriptionLedgerService } from '../subscriptions/subscription-ledger.service';
import { CheckoutAffiliation } from './checkout-affiliation';
import { OrderNotices } from './order-notices';
import { OrderPaymentService } from './order-payment.service';
import { OrdersRepository } from './orders.repository';

const business = { id: 'biz-1', email: 'b@example.test', role: UserRole.BUSINESS, tenantId: 't', tenantScope: 't', impersonating: false } as AuthenticatedUser;

function build(order: Record<string, unknown> | null) {
  const repository = {
    transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work({})),
    lockOrder: jest.fn().mockResolvedValue(order),
    findOrder: jest.fn().mockResolvedValue(order),
    findRow: jest.fn().mockResolvedValue(null),
    history: jest.fn().mockResolvedValue([]),
  };
  const accounts = { findByUserId: jest.fn().mockResolvedValue({ userId: 'biz-1', entityId: 'entity-1', entityType: 'GYM' }) };
  const lifecycle = { confirm: jest.fn(), close: jest.fn() };
  const ledger = { openForOrder: jest.fn().mockResolvedValue({ id: 'period-1', startsOn: '2026-11-17', endsOn: '2026-12-16' }) };
  const affiliation = { lockPerson: jest.fn().mockResolvedValue(undefined) };
  const notices = { send: jest.fn() };
  const service = new BusinessOrdersService(
    accounts as unknown as BusinessAccountsRepository,
    repository as unknown as OrdersRepository,
    lifecycle as unknown as OrderLifecycle,
    ledger as unknown as SubscriptionLedgerService,
    affiliation as unknown as CheckoutAffiliation,
    notices as unknown as OrderNotices,
    {} as OrderPaymentService,
  );
  return { service, lifecycle, ledger, affiliation, notices };
}

const pending = (patch: Record<string, unknown> = {}) => ({
  id: 'order-1',
  entityId: 'entity-1',
  athleteUserId: 'buyer-1',
  status: 'PENDING_VERIFICATION',
  orderNumber: 'GS-ORD-1',
  amount: '250.00',
  currency: 'BOB',
  planSnapshot: { name: 'Plan' },
  receiptAttempts: 1,
  ...patch,
});

describe('BusinessOrdersService (ADR-0024)', () => {
  it("another business's order is 404 and nothing moves", async () => {
    const { service, lifecycle, ledger, affiliation } = build(pending({ entityId: 'entity-2' }));
    await expect(service.confirm(business, 'order-1', { alsoConfirmAffiliation: true })).rejects.toThrow(NotFoundException);
    await expect(service.reject(business, 'order-1', { reasonCode: 'UNREADABLE' })).rejects.toThrow(NotFoundException);
    expect(lifecycle.confirm).not.toHaveBeenCalled();
    expect(lifecycle.close).not.toHaveBeenCalled();
    expect(ledger.openForOrder).not.toHaveBeenCalled();
    // A foreign order never takes its buyer's lock.
    expect(affiliation.lockPerson).not.toHaveBeenCalled();
  });

  it('only an order waiting for the business is decided; a replay is 409', async () => {
    for (const status of ['PENDING_PAYMENT', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED']) {
      const { service, lifecycle, ledger } = build(pending({ status }));
      await expect(service.confirm(business, 'order-1', { alsoConfirmAffiliation: true })).rejects.toMatchObject({ code: 'ORDER_INVALID_TRANSITION' });
      expect(lifecycle.confirm).not.toHaveBeenCalled();
      expect(ledger.openForOrder).not.toHaveBeenCalled();
    }
  });

  it('confirming opens the period under the buyer lock, inside the transaction, and tells the buyer its dates', async () => {
    const { service, lifecycle, ledger, affiliation, notices } = build(pending());
    await expect(service.confirm(business, 'order-1', { alsoConfirmAffiliation: true })).rejects.toThrow(NotFoundException);
    expect(affiliation.lockPerson).toHaveBeenCalledWith('buyer-1', {});
    expect(ledger.openForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      { entityId: 'entity-1', entityType: 'GYM' },
      { actorUserId: 'biz-1', confirmAffiliation: true },
      {},
    );
    expect(lifecycle.confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-1' }), 'biz-1', 'period-1', {});
    expect(notices.send).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ id: 'order-1' }),
      { kind: 'CONFIRMED', period: { id: 'period-1', startsOn: '2026-11-17', endsOn: '2026-12-16' } },
      {},
    );
  });

  it('«también confirmo que es socio» unchecked reaches the ledger; a failing period confirms nothing', async () => {
    const unchecked = build(pending());
    await expect(unchecked.service.confirm(business, 'order-1', { alsoConfirmAffiliation: false })).rejects.toThrow(NotFoundException);
    expect(unchecked.ledger.openForOrder).toHaveBeenCalledWith(expect.anything(), expect.anything(), { actorUserId: 'biz-1', confirmAffiliation: false }, {});

    const failing = build(pending());
    failing.ledger.openForOrder.mockRejectedValue(new Error('period failed'));
    await expect(failing.service.confirm(business, 'order-1', { alsoConfirmAffiliation: true })).rejects.toThrow('period failed');
    expect(failing.lifecycle.confirm).not.toHaveBeenCalled();
    expect(failing.notices.send).not.toHaveBeenCalled();
  });

  it('rejecting with OTHER needs a note (422); with a chip it releases through the lifecycle', async () => {
    const { service, lifecycle } = build(pending());
    await expect(service.reject(business, 'order-1', { reasonCode: 'OTHER' })).rejects.toMatchObject({ code: 'ORDER_REJECTION_NOTE_REQUIRED' });
    expect(lifecycle.close).not.toHaveBeenCalled();
    await expect(service.reject(business, 'order-1', { reasonCode: 'AMOUNT_MISMATCH' })).rejects.toThrow(NotFoundException);
    expect(lifecycle.close).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      'REJECTED',
      expect.objectContaining({ reasonCode: 'AMOUNT_MISMATCH', patch: expect.objectContaining({ rejectionCode: 'AMOUNT_MISMATCH', decidedByUserId: 'biz-1' }) }),
      {},
    );
  });
});

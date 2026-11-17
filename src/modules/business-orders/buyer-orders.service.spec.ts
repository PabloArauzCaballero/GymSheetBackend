import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { UserRole } from '../../common/enums/domain.enums';
import { BuyerOrdersService } from './buyer-orders.service';
import { CheckoutAffiliation } from './checkout-affiliation';
import { OrderLifecycle } from './order-lifecycle.service';
import { OrderNotices } from './order-notices';
import { OrdersRepository } from './orders.repository';
import { SellersRepository } from './sellers.repository';

const buyer = { id: 'buyer-1', email: 'b@example.test', role: UserRole.CLIENT, tenantId: 't', tenantScope: 't', impersonating: false } as AuthenticatedUser;
const listing = (patch: Record<string, unknown> = {}) => ({
  id: 'listing-1',
  entityId: 'entity-1',
  offerKind: 'MEMBERSHIP',
  type: 'MEMBERSHIP_PLAN',
  name: 'Plan mensual',
  description: 'Acceso libre',
  benefits: [],
  durationDays: 30,
  sessionsCount: null,
  currentPrice: '250.00',
  currency: 'BOB',
  status: 'ACTIVE',
  moderationStatus: 'LIVE',
  stockQuantity: null,
  stockReserved: 0,
  ...patch,
});

function build(options: { listing?: Record<string, unknown> | null; entityStatus?: string; entityType?: string; config?: Record<string, unknown> | null; open?: { id: string; planId: string }[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const repository = {
    transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work({})),
    lockBuyer: jest.fn().mockResolvedValue(undefined),
    lockListing: jest.fn().mockResolvedValue(options.listing === null ? null : listing(options.listing)),
    findCurrentPrice: jest.fn().mockResolvedValue({ id: 'price-1' }),
    openOrders: jest.fn().mockResolvedValue(options.open ?? []),
    create: jest.fn((data: Record<string, unknown>) => {
      created.push(data);
      return Promise.resolve({ id: 'order-1', orderNumber: 'GS-ORD-1', ...data });
    }),
    recordTransition: jest.fn().mockResolvedValue(undefined),
    findRow: jest.fn().mockResolvedValue(null),
    history: jest.fn().mockResolvedValue([]),
  };
  const sellers = {
    findSeller: jest.fn().mockResolvedValue({ entityId: 'entity-1', entityType: options.entityType ?? 'COACH', entityStatus: options.entityStatus ?? 'ACTIVE', ownerUserId: 'biz-1', accountStatus: 'ACTIVE' }),
    findConfig: jest.fn().mockResolvedValue(options.config === null ? null : { isActive: true, qrPrivateKey: 'business/x/payment/y.bin', acceptsCash: false, ...options.config }),
  };
  const lifecycle = { reserve: jest.fn().mockResolvedValue(0) };
  const notices = { send: jest.fn() };
  const affiliation = { lockPerson: jest.fn().mockResolvedValue(undefined), ensureSocio: jest.fn().mockResolvedValue(undefined) };
  const service = new BuyerOrdersService(
    repository as unknown as OrdersRepository,
    sellers as unknown as SellersRepository,
    lifecycle as unknown as OrderLifecycle,
    notices as unknown as OrderNotices,
    affiliation as unknown as CheckoutAffiliation,
  );
  return { service, repository, created, lifecycle, affiliation };
}

describe('BuyerOrdersService.create (ADR-0024)', () => {
  it('takes the price from the listing and freezes what was offered', async () => {
    const { service, created } = build();
    await expect(service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toThrow(NotFoundException);
    expect(created[0]).toMatchObject({ unitAmount: '250.00', amount: '250.00', quantity: 1, status: 'PENDING_PAYMENT', priceHistoryId: 'price-1' });
    expect(created[0].planSnapshot).toMatchObject({ id: 'listing-1', name: 'Plan mensual', offerKind: 'MEMBERSHIP', validityDays: 30 });
  });

  it.each([
    ['no listing', { listing: null }],
    ['a held listing', { listing: { moderationStatus: 'HELD' } }],
    ['a paused listing', { listing: { status: 'INACTIVE' } }],
    ['a seller that is not public', { entityStatus: 'SUSPENDED' }],
  ])('answers 404 for %s, creating nothing', async (_label, options) => {
    const { service, repository } = build(options);
    await expect(service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toThrow(NotFoundException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses several units of anything but a product, a method the seller does not take, and a second open order', async () => {
    await expect(build().service.create(buyer, { listingId: 'listing-1', quantity: 2, method: 'QR' })).rejects.toMatchObject({ code: 'ORDER_QUANTITY_NOT_ALLOWED' });
    await expect(build().service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'CASH' })).rejects.toMatchObject({ code: 'ORDER_PAYMENT_METHOD_UNAVAILABLE' });
    await expect(build({ config: { qrPrivateKey: null } }).service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toMatchObject({
      code: 'ORDER_PAYMENT_METHOD_UNAVAILABLE',
    });
    await expect(build({ open: [{ id: 'o-9', planId: 'listing-1' }] }).service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toMatchObject({
      code: 'ORDER_ALREADY_OPEN',
    });
    const many = Array.from({ length: 5 }, (_, index) => ({ id: `o-${index}`, planId: `other-${index}` }));
    await expect(build({ open: many }).service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toMatchObject({ code: 'ORDER_OPEN_LIMIT' });
  });

  it('a product order of several units reserves them and totals them in cents', async () => {
    const { service, created, lifecycle } = build({ listing: { offerKind: 'PRODUCT', currentPrice: '120.50', stockQuantity: 5 } });
    lifecycle.reserve.mockResolvedValue(3);
    await expect(service.create(buyer, { listingId: 'listing-1', quantity: 3, method: 'QR' })).rejects.toThrow(NotFoundException);
    expect(created[0]).toMatchObject({ quantity: 3, amount: '361.50', stockReservedUnits: 3 });
  });

  it("a gym's membership checks the buyer's SOCIO affiliation (with the checkout's data) before the order exists", async () => {
    const gym = build({ entityType: 'GYM' });
    const affiliation = { locationId: '00000000-0000-4000-8000-000000000001', ciLast3: '123', switchGym: false };
    await expect(gym.service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR', affiliation })).rejects.toThrow(NotFoundException);
    expect(gym.affiliation.lockPerson).toHaveBeenCalledWith('buyer-1', {});
    expect(gym.affiliation.ensureSocio).toHaveBeenCalledWith(buyer, 'entity-1', affiliation, {});

    // A refused affiliation (e.g. SOCIO of another gym) creates no order.
    const refused = build({ entityType: 'GYM' });
    refused.affiliation.ensureSocio.mockRejectedValue(Object.assign(new Error('409'), { code: 'SOCIO_OF_ANOTHER_GYM' }));
    await expect(refused.service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toMatchObject({ code: 'SOCIO_OF_ANOTHER_GYM' });
    expect(refused.repository.create).not.toHaveBeenCalled();

    // A day pass of a gym, or a coach's membership, needs no affiliation.
    const pass = build({ entityType: 'GYM', listing: { offerKind: 'DAY_PASS', durationDays: null } });
    await expect(pass.service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toThrow(NotFoundException);
    const coach = build();
    await expect(coach.service.create(buyer, { listingId: 'listing-1', quantity: 1, method: 'QR' })).rejects.toThrow(NotFoundException);
    expect(pass.affiliation.ensureSocio).not.toHaveBeenCalled();
    expect(coach.affiliation.ensureSocio).not.toHaveBeenCalled();
  });
});

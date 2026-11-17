import { OrderLifecycle } from './order-lifecycle.service';
import { OrdersRepository } from './orders.repository';

function build() {
  const repository = { adjustStock: jest.fn(), update: jest.fn(), recordTransition: jest.fn() };
  return { repository, lifecycle: new OrderLifecycle(repository as unknown as OrdersRepository) };
}

const order = (units: number) => ({ id: 'order-1', planId: 'listing-1', status: 'PENDING_VERIFICATION', stockReservedUnits: units }) as never;

describe('OrderLifecycle (ADR-0024)', () => {
  it('reserves under the listing lock and refuses more than what is left (409 with what is available)', async () => {
    const { lifecycle, repository } = build();
    await expect(lifecycle.reserve({ id: 'listing-1', stockQuantity: 5, stockReserved: 4 } as never, 2, {} as never)).rejects.toMatchObject({
      code: 'ORDER_OUT_OF_STOCK',
      details: { available: 1 },
    });
    expect(await lifecycle.reserve({ id: 'listing-1', stockQuantity: 5, stockReserved: 3 } as never, 2, {} as never)).toBe(2);
    expect(repository.adjustStock).toHaveBeenCalledWith('listing-1', 2, 0, {});
    expect(await lifecycle.reserve({ id: 'listing-2', stockQuantity: null, stockReserved: 0 } as never, 9, {} as never)).toBe(0);
  });

  it('closing returns the held units; confirming consumes them from both counters; each change has its history row', async () => {
    const { lifecycle, repository } = build();
    await lifecycle.close(order(2), 'REJECTED', { actorUserId: 'biz-1', reasonCode: 'UNREADABLE', patch: {} }, {} as never);
    expect(repository.adjustStock).toHaveBeenLastCalledWith('listing-1', -2, 0, {});
    expect(repository.update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'REJECTED', stockReservedUnits: 0 }), {});
    await lifecycle.confirm(order(3), 'biz-1', null, {} as never);
    expect(repository.adjustStock).toHaveBeenLastCalledWith('listing-1', -3, -3, {});
    expect(repository.recordTransition).toHaveBeenLastCalledWith(
      { orderId: 'order-1', from: 'PENDING_VERIFICATION', to: 'CONFIRMED', actorUserId: 'biz-1', reasonCode: null },
      {},
    );
    repository.adjustStock.mockClear();
    await lifecycle.close(order(0), 'EXPIRED', { actorUserId: null, reasonCode: 'EXPIRED', patch: {} }, {} as never);
    expect(repository.adjustStock).not.toHaveBeenCalled();
  });
});

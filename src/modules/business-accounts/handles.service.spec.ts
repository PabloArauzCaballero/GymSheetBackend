import { Transaction } from 'sequelize';
import { DirectoryService } from '../directory/directory.service';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { addDays } from './handle-rules';
import { HandleRow, HandlesRepository } from './handles.repository';
import { HandlesService } from './handles.service';

const T0 = new Date('2026-11-01T12:00:00Z');
const transaction = {} as Transaction;

/** A PENDING reservation lives 14 days from the listing's creation, whatever is re-claimed meanwhile. */
describe('HandlesService.claim, PENDING expiry with a fixed clock', () => {
  function setup(current: Partial<HandleRow> | null, submittedKyc = false) {
    const repository = {
      hasSubmittedKyc: jest.fn().mockResolvedValue(submittedKyc),
      lockSkeleton: jest.fn().mockResolvedValue(undefined),
      deleteExpired: jest.fn().mockResolvedValue(undefined),
      findCurrent: jest.fn().mockResolvedValue(current),
      findHolders: jest.fn().mockResolvedValue([]),
      deleteHandle: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const service = new HandlesService(repository as unknown as HandlesRepository, {} as DirectoryService);
    const entity = { id: 'entity-1', status: 'DRAFT', createdAt: T0 } as DirectoryEntityModel;
    return { service, repository, entity };
  }

  it('once the KYC was sent (ADR-0021) the window no longer closes: day 15 still claims while resubmitting', async () => {
    const { service, repository, entity } = setup({ handle: 'topfit', status: 'PENDING' }, true);
    await expect(service.claim(entity, 'otrofit', 'user-1', transaction, addDays(T0, 15))).resolves.toEqual({ handle: 'otrofit', status: 'PENDING' });
    expect(repository.hasSubmittedKyc).toHaveBeenCalledWith('entity-1', transaction);
  });

  it('re-claiming the same handle on day 13 writes nothing, so the reservation is not extended', async () => {
    const { service, repository, entity } = setup({ handle: 'topfit', status: 'PENDING' });
    const now = addDays(T0, 13);
    await expect(service.claim(entity, '@TopFit', 'user-1', transaction, now)).resolves.toEqual({ handle: 'topfit', status: 'PENDING' });
    expect(repository.findCurrent).toHaveBeenCalledWith('entity-1', now, transaction);
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.deleteHandle).not.toHaveBeenCalled();
    expect('touch' in repository).toBe(false);
  });

  it('on day 15 the window is closed: re-claiming the same handle is refused', async () => {
    const { service, repository, entity } = setup({ handle: 'topfit', status: 'PENDING' });
    await expect(service.claim(entity, 'topfit', 'user-1', transaction, addDays(T0, 15))).rejects.toMatchObject({
      code: 'HANDLE_RESERVATION_EXPIRED',
      status: 409,
    });
    expect(repository.lockSkeleton).not.toHaveBeenCalled();
  });

  it('switching handles does not reopen the window either', async () => {
    const { service, repository, entity } = setup(null);
    await service.claim(entity, 'otrofit', 'user-1', transaction, addDays(T0, 13));
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ handle: 'otrofit', status: 'PENDING' }), transaction);
    await expect(service.claim(entity, 'tercerofit', 'user-1', transaction, addDays(T0, 14))).rejects.toMatchObject({
      code: 'HANDLE_RESERVATION_EXPIRED',
    });
  });

  it('a listing past DRAFT is not bound by the reservation window', async () => {
    const { service, entity } = setup({ handle: 'topfit', status: 'ACTIVE' });
    const active = { ...entity, status: 'ACTIVE' } as DirectoryEntityModel;
    await expect(service.claim(active, 'topfit', 'user-1', transaction, addDays(T0, 60))).resolves.toEqual({ handle: 'topfit', status: 'ACTIVE' });
  });
});

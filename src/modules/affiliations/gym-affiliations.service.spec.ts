import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { AffiliationNotices } from './affiliation-notices';
import { AffiliationViewsRepository } from './affiliation-views.repository';
import { AffiliationRow, AffiliationsRepository } from './affiliations.repository';
import { GymAffiliationsService } from './gym-affiliations.service';

const actor = { id: 'gym-b-owner', role: UserRole.BUSINESS } as AuthenticatedUser;

const row = (patch: Partial<AffiliationRow> = {}): AffiliationRow => ({
  id: 'new-1',
  gymEntityId: 'gym-b',
  userId: 'person-1',
  coachEntityId: null,
  kind: 'SOCIO',
  status: 'REQUESTED',
  reasonCode: null,
  ...patch,
});

function build(options: { request?: AffiliationRow | null; previous?: AffiliationRow | null; entityType?: string; gymStatus?: string } = {}) {
  const request = options.request === undefined ? row() : options.request;
  const repository = {
    transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work({})),
    findGym: jest.fn(({ entityId }: { entityId: string }) => Promise.resolve({ entityId, name: entityId === 'gym-a' ? 'Gym A' : 'Gym B', status: options.gymStatus ?? 'ACTIVE', ownerUserId: 'o' })),
    find: jest.fn().mockResolvedValue(request),
    lock: jest.fn().mockResolvedValue(request),
    lockSubject: jest.fn(),
    lockConfirmedSocio: jest.fn().mockResolvedValue(options.previous ?? null),
    transition: jest.fn().mockResolvedValue(undefined),
    recipientOf: jest.fn().mockResolvedValue('person-1'),
  };
  const views = { listRequests: jest.fn().mockResolvedValue([]), countRequests: jest.fn().mockResolvedValue(0), findForGym: jest.fn().mockResolvedValue({ id: 'new-1', kind: 'SOCIO', status: 'CONFIRMED', requestedAt: new Date(), confirmedAt: new Date(), subjectType: 'PERSON' }) };
  const accounts = { findByUserId: jest.fn().mockResolvedValue({ entityId: 'gym-b', entityType: options.entityType ?? 'GYM' }) };
  const notices = { send: jest.fn() };
  const service = new GymAffiliationsService(
    accounts as unknown as BusinessAccountsRepository,
    repository as unknown as AffiliationsRepository,
    views as unknown as AffiliationViewsRepository,
    notices as unknown as AffiliationNotices,
  );
  return { service, repository, notices };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error: unknown) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string; statusCode?: number } | undefined;
    return response?.code ?? response?.statusCode ?? 'unknown';
  }
};

describe('GymAffiliationsService (ADR-0025)', () => {
  it('only a GYM business manages affiliations; another gym’s row is 404 and nothing moves', async () => {
    expect(await codeOf(build({ entityType: 'COACH' }).service.confirm(actor, 'new-1'))).toBe('BUSINESS_TYPE_NOT_ALLOWED');
    const foreign = build({ request: row({ gymEntityId: 'gym-z' }) });
    expect(await codeOf(foreign.service.confirm(actor, 'new-1'))).toBe(404);
    expect(await codeOf(foreign.service.reject(actor, 'new-1', { reasonCode: 'CI_MISMATCH' }))).toBe(404);
    expect(foreign.repository.transition).not.toHaveBeenCalled();
  });

  it('a gym switch ends the confirmed SOCIO elsewhere before confirming the new one, in the same transaction', async () => {
    const { service, repository, notices } = build({ previous: row({ id: 'old-1', gymEntityId: 'gym-a', status: 'CONFIRMED' }) });
    await service.confirm(actor, 'new-1');
    expect(repository.transition.mock.calls.map(([id, change]): [string, string] => [String(id), (change as { status: string }).status])).toEqual([
      ['old-1', 'ENDED'],
      ['new-1', 'CONFIRMED'],
    ]);
    expect(repository.transition.mock.calls[0][1]).toEqual({ status: 'ENDED', changedByUserId: null, reasonCode: 'SWITCHED_GYM' });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(notices.send.mock.calls.map(([, , notice]) => (notice as { event: string }).event)).toEqual(['ENDED', 'CONFIRMED']);
  });

  it('confirms only REQUESTED rows of a public gym', async () => {
    expect(await codeOf(build({ request: row({ status: 'CONFIRMED' }) }).service.confirm(actor, 'new-1'))).toBe('AFFILIATION_INVALID_TRANSITION');
    expect(await codeOf(build({ gymStatus: 'SUSPENDED' }).service.confirm(actor, 'new-1'))).toBe('GYM_NOT_ACTIVE');
  });

  it('a rejection or an end with OTHER needs a note', async () => {
    const { service, repository } = build();
    expect(await codeOf(service.reject(actor, 'new-1', { reasonCode: 'OTHER' }))).toBe('AFFILIATION_NOTE_REQUIRED');
    expect(await codeOf(service.end(actor, 'new-1', { reasonCode: 'OTHER' }))).toBe('AFFILIATION_NOTE_REQUIRED');
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('a gym that is not public (REPP suspended it) neither reads nor decides pending requests', async () => {
    const { service, repository } = build({ gymStatus: 'SUSPENDED' });
    expect(await codeOf(service.listRequests(actor, { limit: 20 }))).toBe('GYM_NOT_ACTIVE');
    expect(await codeOf(service.reject(actor, 'new-1', { reasonCode: 'CI_MISMATCH' }))).toBe('GYM_NOT_ACTIVE');
    expect(repository.transition).not.toHaveBeenCalled();
    expect(await codeOf(build({ gymStatus: 'ACTIVE' }).service.listRequests(actor, { limit: 20 }))).toBe('resolved');
  });
});

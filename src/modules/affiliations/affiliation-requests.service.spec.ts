import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { AffiliationNotices } from './affiliation-notices';
import { AffiliationRequestsService, SubjectRequest } from './affiliation-requests.service';
import { AffiliationViewsRepository } from './affiliation-views.repository';
import { AffiliationRow, AffiliationsRepository, Subject } from './affiliations.repository';

const person: Subject = { type: 'PERSON', userId: 'person-1' };
const gym = { entityId: 'gym-b', name: 'Gym B', status: 'ACTIVE', ownerUserId: 'gym-b-owner' };
const view = { id: 'new-1', kind: 'SOCIO', status: 'REQUESTED', requestedAt: new Date(), gymId: 'gym-b', gymName: 'Gym B', cursorKey: 'k' };

const row = (patch: Partial<AffiliationRow>): AffiliationRow => ({
  id: 'aff-1',
  gymEntityId: 'gym-a',
  userId: 'person-1',
  coachEntityId: null,
  kind: 'SOCIO',
  status: 'CONFIRMED',
  reasonCode: null,
  ...patch,
});

function build(options: { live?: AffiliationRow[]; gym?: typeof gym | null; location?: boolean; lastClosed?: unknown; entityType?: string } = {}) {
  const repository = {
    transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work({})),
    lockSubject: jest.fn(),
    findGym: jest.fn().mockResolvedValue(options.gym === undefined ? gym : options.gym),
    locationOfGym: jest.fn().mockResolvedValue(options.location ?? true),
    liveOf: jest.fn().mockResolvedValue(options.live ?? []),
    lastClosed: jest.fn().mockResolvedValue(options.lastClosed ?? null),
    insert: jest.fn().mockResolvedValue('new-1'),
  };
  const views = { findOwn: jest.fn().mockResolvedValue(view) };
  const accounts = {
    findByUserId: jest.fn().mockResolvedValue({ entityId: 'coach-1', entityType: options.entityType ?? 'COACH' }),
    findEntity: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
  };
  const notices = { send: jest.fn() };
  const service = new AffiliationRequestsService(
    repository as unknown as AffiliationsRepository,
    views as unknown as AffiliationViewsRepository,
    accounts as unknown as BusinessAccountsRepository,
    notices as unknown as AffiliationNotices,
  );
  return { service, repository, notices };
}

const socio = (patch: Partial<SubjectRequest> = {}): SubjectRequest => ({ gymHandle: '@gym.b', kind: 'SOCIO', locationId: 'loc-1', ciLast3: '123', switchGym: false, ...patch });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error: unknown) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string; statusCode?: number } | undefined;
    return response?.code ?? response?.statusCode ?? 'unknown';
  }
};

describe('AffiliationRequestsService (ADR-0025)', () => {
  it('a gym that is not public is 404, the same as one that does not exist', async () => {
    for (const found of [null, { ...gym, status: 'SUSPENDED' }, { ...gym, status: 'DRAFT' }]) {
      const { service, repository } = build({ gym: found });
      expect(await codeOf(service.request(person, socio()))).toBe(404);
      expect(repository.insert).not.toHaveBeenCalled();
    }
  });

  it('a location of another gym is a 400 and nothing is written', async () => {
    const { service, repository } = build({ location: false });
    expect(await codeOf(service.request(person, socio()))).toBe('AFFILIATION_LOCATION_INVALID');
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('a confirmed SOCIO elsewhere answers 409 SOCIO_OF_ANOTHER_GYM unless the person asks for the switch', async () => {
    const current = row({});
    const refused = build({ live: [current] });
    expect(await codeOf(refused.service.request(person, socio()))).toBe('SOCIO_OF_ANOTHER_GYM');
    expect(refused.repository.insert).not.toHaveBeenCalled();

    const switching = build({ live: [current] });
    await switching.service.request(person, socio({ switchGym: true }));
    expect(switching.repository.insert).toHaveBeenCalledWith(expect.objectContaining({ replacesId: 'aff-1', gymEntityId: 'gym-b' }), {});
    expect(switching.notices.send).toHaveBeenCalledWith('gym-b-owner', { id: 'new-1', kind: 'SOCIO' }, { event: 'REQUESTED', subject: 'PERSON' }, {});
  });

  it('one pending SOCIO request at a time, one live row per gym and kind', async () => {
    expect(await codeOf(build({ live: [row({ gymEntityId: 'gym-c', status: 'REQUESTED' })] }).service.request(person, socio()))).toBe('AFFILIATION_SOCIO_PENDING');
    expect(await codeOf(build({ live: [row({ gymEntityId: 'gym-b', status: 'REQUESTED' })] }).service.request(person, socio()))).toBe('AFFILIATION_ALREADY_LIVE');
    // A coach of several gyms: ENTRENADOR elsewhere does not block.
    const coaching = build({ live: [row({ gymEntityId: 'gym-c', kind: 'ENTRENADOR' })] });
    expect(await codeOf(coaching.service.request(person, socio({ kind: 'ENTRENADOR', locationId: undefined })))).toBe('resolved');
  });

  it('caps pending requests and holds back a repeat after the gym said no', async () => {
    const pending = Array.from({ length: 5 }, (_, index) => row({ id: `p-${index}`, gymEntityId: `gym-${index}`, kind: 'ENTRENADOR', status: 'REQUESTED' }));
    expect(await codeOf(build({ live: pending }).service.request(person, socio({ kind: 'ENTRENADOR' })))).toBe('AFFILIATION_LIMIT');
    const rejected = build({ lastClosed: { reasonCode: 'CI_MISMATCH', closedAt: new Date() } });
    expect(await codeOf(rejected.service.request(person, socio()))).toBe('AFFILIATION_COOLDOWN');
  });

  it('only a COACH business asks through gym-links (another business type is 403)', async () => {
    const actor = { id: 'biz-1', role: UserRole.BUSINESS } as AuthenticatedUser;
    expect(await codeOf(build({ entityType: 'GYM' }).service.coachOf(actor))).toBe('BUSINESS_TYPE_NOT_ALLOWED');
    expect(await build().service.coachOf(actor)).toEqual({ type: 'COACH', entityId: 'coach-1', ownerUserId: 'biz-1' });
  });
});

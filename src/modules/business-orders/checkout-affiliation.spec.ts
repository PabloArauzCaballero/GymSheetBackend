import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AffiliationNotices } from '../affiliations/affiliation-notices';
import { AffiliationRequestsService } from '../affiliations/affiliation-requests.service';
import { AffiliationViewsRepository } from '../affiliations/affiliation-views.repository';
import { AffiliationRow, AffiliationsRepository } from '../affiliations/affiliations.repository';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { CheckoutAffiliation } from './checkout-affiliation';

const person = { id: 'buyer-1', email: 'p@example.test', role: UserRole.CLIENT, tenantId: 't', tenantScope: 't', impersonating: false, emailVerified: true } as AuthenticatedUser;
const GYM = 'gym-new';
const input = { locationId: '00000000-0000-4000-8000-000000000001', ciLast3: '123', switchGym: false };

const row = (patch: Partial<AffiliationRow>): AffiliationRow => ({
  id: 'aff-1',
  gymEntityId: 'gym-old',
  userId: 'buyer-1',
  coachEntityId: null,
  kind: 'SOCIO',
  status: 'CONFIRMED',
  reasonCode: null,
  ...patch,
});

/** A real AffiliationRequestsService (ADR-0025's rules) over a repository double. */
function build(live: AffiliationRow[]) {
  const repository = {
    lockSubject: jest.fn().mockResolvedValue(undefined),
    liveOf: jest.fn().mockResolvedValue(live),
    findGym: jest.fn().mockResolvedValue({ entityId: GYM, name: 'Nuevo', status: 'ACTIVE', ownerUserId: 'gym-owner' }),
    locationOfGym: jest.fn().mockResolvedValue(true),
    lastClosed: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue('aff-new'),
  };
  const notices = { send: jest.fn() };
  const requests = new AffiliationRequestsService(
    repository as unknown as AffiliationsRepository,
    {} as AffiliationViewsRepository,
    {} as BusinessAccountsRepository,
    notices as unknown as AffiliationNotices,
  );
  return { checkout: new CheckoutAffiliation(repository as unknown as AffiliationsRepository, requests), repository };
}

describe('CheckoutAffiliation (ADR-0026)', () => {
  it('a confirmed SOCIO of another gym is 409 SOCIO_OF_ANOTHER_GYM with the switch action, and nothing is inserted', async () => {
    const { checkout, repository } = build([row({})]);
    await expect(checkout.ensureSocio(person, GYM, input, {} as never)).rejects.toMatchObject({
      code: 'SOCIO_OF_ANOTHER_GYM',
      details: { affiliationId: 'aff-1', action: 'SWITCH_GYM' },
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('with switchGym the request is created, marked as replacing the current one', async () => {
    const { checkout, repository } = build([row({})]);
    await checkout.ensureSocio(person, GYM, { ...input, switchGym: true }, {} as never);
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ gymEntityId: GYM, kind: 'SOCIO', ciLast3: '123', replacesId: 'aff-1' }), {});
  });

  it('without the checkout data a membership of a gym the person is not SOCIO of is 422 AFFILIATION_REQUIRED', async () => {
    const { checkout } = build([]);
    await expect(checkout.ensureSocio(person, GYM, undefined, {} as never)).rejects.toMatchObject({ code: 'AFFILIATION_REQUIRED' });
  });

  it('a SOCIO (or a pending request) of this gym buys as is; an unverified mailbox cannot create the request', async () => {
    for (const status of ['CONFIRMED', 'REQUESTED'] as const) {
      const { checkout, repository } = build([row({ gymEntityId: GYM, status })]);
      await checkout.ensureSocio(person, GYM, undefined, {} as never);
      expect(repository.insert).not.toHaveBeenCalled();
    }
    const { checkout } = build([]);
    await expect(checkout.ensureSocio({ ...person, emailVerified: false }, GYM, input, {} as never)).rejects.toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });
  });
});

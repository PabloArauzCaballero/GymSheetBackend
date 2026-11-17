import { NotFoundException } from '@nestjs/common';
import { DirectoryPaymentsRepository } from './directory-payments.repository';
import { DirectoryPaymentsService } from './directory-payments.service';

const plan = (patch: Record<string, unknown> = {}) => ({
  id: 'plan-1',
  entityId: 'entity-1',
  type: 'MEMBERSHIP_PLAN',
  name: 'Plan',
  slug: 'plan',
  description: 'Plan mensual',
  benefits: [],
  durationDays: 30,
  currentPrice: '250.00',
  currency: 'BOB',
  status: 'ACTIVE',
  moderationStatus: 'LIVE',
  displayOrder: 0,
  mediaUrls: [],
  metadata: { internal: true },
  entity: { status: 'ACTIVE' },
  ...patch,
});

function build(options: { plan?: Record<string, unknown> | null; entityStatus?: string } = {}) {
  const repository = {
    findEntityById: jest.fn().mockResolvedValue({ id: 'entity-1', status: options.entityStatus ?? 'ACTIVE' }),
    findPlanById: jest.fn().mockResolvedValue(options.plan === null ? null : plan(options.plan)),
    listPlans: jest.fn().mockResolvedValue([plan()]),
    listAllMarketplacePlans: jest.fn().mockResolvedValue([plan()]),
  };
  return { service: new DirectoryPaymentsService(repository as unknown as DirectoryPaymentsRepository), repository };
}

describe('DirectoryPaymentsService — legacy public plan reads', () => {
  it('D4: a public plan comes mapped, without internal metadata', async () => {
    expect((await build().service.getPublicPlan('plan-1')).metadata).toEqual({});
    expect((await build().service.listPublicPlans('entity-1'))[0].metadata).toEqual({});
  });

  it.each([
    ['missing', { plan: null }],
    ['not ACTIVE', { plan: { status: 'INACTIVE' } }],
    ['not LIVE (ADR-0022)', { plan: { moderationStatus: 'HELD' } }],
    ['of a seller that is not public (D7)', { plan: { entity: { status: 'SUSPENDED' } } }],
  ])('a plan %s answers 404', async (_label, options) => {
    await expect(build(options).service.getPublicPlan('plan-1')).rejects.toThrow(NotFoundException);
  });

  it('D7: the plans of a seller that is not public answer 404', async () => {
    const { service, repository } = build({ entityStatus: 'PAUSED' });
    await expect(service.listPublicPlans('entity-1')).rejects.toThrow(NotFoundException);
    expect(repository.listPlans).not.toHaveBeenCalled();
  });
});

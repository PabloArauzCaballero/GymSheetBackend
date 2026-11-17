import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ModerationAutoHideService } from './moderation-auto-hide.service';
import { ModerationReason, ModerationResolution, ModerationTargetKind } from './moderation.policy';
import { ModerationService } from './moderation.service';

const moderator: AuthenticatedUser = {
  id: 'mod-1',
  email: 'moderacion@repp.test',
  role: UserRole.MODERATOR,
  tenantId: 'topfitness',
  tenantScope: 'topfitness',
  impersonating: false,
};

function build() {
  const repository = {
    findOpenReportsForTarget: jest.fn().mockResolvedValue([
      { id: 'report-1', reporterUserId: 'person-1', reportedUserId: 'biz-1', tenantId: 'topfitness', reason: ModerationReason.PERFIL_FALSO },
    ]),
    findAccountRole: jest.fn().mockResolvedValue(UserRole.BUSINESS),
    findAccountEmail: jest.fn().mockResolvedValue('negocio@example.test'),
    findBusinessEntityOf: jest.fn().mockResolvedValue('entity-1'),
    setContentHidden: jest.fn().mockResolvedValue(undefined),
    createStrike: jest.fn(),
    resolveTarget: jest.fn().mockResolvedValue(1),
  };
  const transaction = { id: 'tx' };
  const sequelize = { transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) => callback(transaction)), query: jest.fn() };
  const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
  const safeguards = { closeAutoHideReview: jest.fn().mockResolvedValue(false) };
  const minors = { confirm: jest.fn(), liftIfCleared: jest.fn() };
  const businessAdmin = { suspendEntityFromCase: jest.fn().mockResolvedValue(undefined) };
  const autoHide = new ModerationAutoHideService(sequelize as never, repository as never, safeguards as never, notifications as never);
  const service = new ModerationService(
    sequelize as never,
    repository as never,
    notifications as never,
    {} as never,
    {} as never,
    minors as never,
    {} as never,
    autoHide,
    { enqueue: jest.fn() } as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    businessAdmin as never,
  );
  return { service, repository, businessAdmin, minors, transaction };
}

const verdict = { hideContent: false, sanction: false, confirmMinor: false, suspendBusiness: false, note: null };

describe('ModerationService on marketplace cases (ADR-0022)', () => {
  it('suspends the business inside the verdict transaction and closes the case as NEGOCIO_SUSPENDIDO', async () => {
    const { service, businessAdmin, repository, transaction } = build();
    const result = await service.resolve(moderator, ModerationTargetKind.BUSINESS_PROFILE, 'entity-1', { ...verdict, suspendBusiness: true, note: 'Suplanta a otro gimnasio' });
    expect(businessAdmin.suspendEntityFromCase).toHaveBeenCalledWith(moderator, 'entity-1', { reasonCode: 'IMPERSONATION', note: 'Suplanta a otro gimnasio' }, transaction);
    expect(repository.resolveTarget).toHaveBeenCalledWith(expect.objectContaining({ resolution: ModerationResolution.NEGOCIO_SUSPENDIDO, discarded: false }), transaction);
    expect(result).toMatchObject({ resolution: 'NEGOCIO_SUSPENDIDO', businessSuspended: true, contentHidden: false });
  });

  it('hides a listing without touching the person ladder', async () => {
    const { service, repository, businessAdmin } = build();
    await service.resolve(moderator, ModerationTargetKind.BUSINESS_LISTING, 'listing-1', { ...verdict, hideContent: true });
    expect(repository.setContentHidden).toHaveBeenCalledWith(expect.objectContaining({ targetKind: 'BUSINESS_LISTING', hidden: true }), expect.anything());
    expect(repository.createStrike).not.toHaveBeenCalled();
    expect(businessAdmin.suspendEntityFromCase).not.toHaveBeenCalled();
  });

  it.each([
    ['a strike on a business case', ModerationTargetKind.BUSINESS_LISTING, { sanction: true }],
    ['confirming a minor on a business case', ModerationTargetKind.BUSINESS_PROFILE, { confirmMinor: true }],
    ['suspending a business from a person case', ModerationTargetKind.STORY, { suspendBusiness: true }],
  ])('refuses %s with 422 before applying anything', async (_label, kind, patch) => {
    const { service, repository, businessAdmin, minors } = build();
    await expect(service.resolve(moderator, kind, 'target-1', { ...verdict, ...patch })).rejects.toMatchObject({
      code: 'MODERATION_RESOLUTION_NOT_APPLICABLE',
    });
    expect(repository.resolveTarget).not.toHaveBeenCalled();
    expect(repository.setContentHidden).not.toHaveBeenCalled();
    expect(businessAdmin.suspendEntityFromCase).not.toHaveBeenCalled();
    expect(minors.confirm).not.toHaveBeenCalled();
  });

  it('a moderator never decides on a business opened with their own mailbox (403 MODERATION_SELF_CASE)', async () => {
    const { service, repository, businessAdmin } = build();
    repository.findAccountEmail.mockResolvedValue('Moderacion+mi-tienda@repp.test');
    await expect(service.resolve(moderator, ModerationTargetKind.BUSINESS_PROFILE, 'entity-1', { ...verdict, suspendBusiness: true })).rejects.toMatchObject({
      code: 'MODERATION_SELF_CASE',
    });
    expect(businessAdmin.suspendEntityFromCase).not.toHaveBeenCalled();
  });
});

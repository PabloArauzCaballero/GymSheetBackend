import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { MediaReferenceReleaseService } from '../media/media-reference-release.service';
import { MediaStorageProvider } from '../media/media-storage.port';
import { UsersRepository } from '../users/users.repository';
import { BusinessAccountRow, BusinessAccountsRepository } from './business-accounts.repository';
import { BusinessAccountsService } from './business-accounts.service';
import { HandlesService } from './handles.service';

const actor = { id: 'user-1' } as AuthenticatedUser;
const account = {
  userId: 'user-1',
  entityId: 'entity-1',
  entityType: 'GYM',
  status: 'ONBOARDING',
  kycStatus: 'DRAFT',
  createdAt: new Date('2026-11-01T12:00:00Z'),
} as BusinessAccountRow;

/** `PATCH /business/me/profile`: the commercial name and the category are material (ADR-0020). */
describe('BusinessAccountsService.updateProfile', () => {
  function setup(entityStatus: DirectoryEntityModel['status'], nameHolder: 'RESERVED' | 'TOO_SIMILAR' | null = null) {
    const entity = { id: 'entity-1', status: entityStatus, name: 'Top Fit', primaryCategoryId: 'cat-1' } as DirectoryEntityModel;
    const repository = {
      findByUserId: jest.fn().mockResolvedValue(account),
      findEntity: jest.fn().mockResolvedValue(entity),
      lockEntity: jest.fn().mockResolvedValue(entity),
      updateEntity: jest.fn().mockResolvedValue(undefined),
      categoryFits: jest.fn().mockResolvedValue(true),
      findNameHolder: jest.fn().mockResolvedValue(nameHolder),
    };
    const users = { updateFullName: jest.fn().mockResolvedValue(undefined) };
    const sequelize = { transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}) };
    const handles = { current: jest.fn().mockResolvedValue(null) };
    const service = new BusinessAccountsService(
      sequelize as unknown as Sequelize,
      repository as unknown as BusinessAccountsRepository,
      handles as unknown as HandlesService,
      users as unknown as UsersRepository,
      {} as MediaReferenceReleaseService,
      {} as MediaStorageProvider,
    );
    return { service, repository, users };
  }

  it('DRAFT: a new name passes the name checks, is saved and renames the account', async () => {
    const { service, repository, users } = setup('DRAFT');
    await service.updateProfile(actor, { name: 'Fuerza Norte', primaryCategoryId: 'cat-2' });
    expect(repository.findNameHolder).toHaveBeenCalledWith('fuerzanorte', 'GYM', 'entity-1', {});
    expect(repository.updateEntity).toHaveBeenCalledWith(expect.anything(), { name: 'Fuerza Norte', primaryCategoryId: 'cat-2' }, {});
    expect(users.updateFullName).toHaveBeenCalledWith('user-1', 'Fuerza Norte', {});
  });

  it('DRAFT: a reserved name is refused before anything is written', async () => {
    const { service, repository, users } = setup('DRAFT');
    await expect(service.updateProfile(actor, { name: 'Repp Gym' })).rejects.toMatchObject({ code: 'BUSINESS_NAME_RESERVED' });
    expect(repository.updateEntity).not.toHaveBeenCalled();
    expect(users.updateFullName).not.toHaveBeenCalled();
  });

  it('DRAFT: a name with the skeleton of a public listing of the same type is refused', async () => {
    const { service, repository } = setup('DRAFT', 'TOO_SIMILAR');
    await expect(service.updateProfile(actor, { name: 'T0p-Fit Center' })).rejects.toMatchObject({ code: 'BUSINESS_NAME_TOO_SIMILAR' });
    expect(repository.updateEntity).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTIVE', { name: 'Nike Store' }],
    ['ACTIVE', { primaryCategoryId: 'cat-2' }],
    ['PAUSED', { name: 'Nike Store', city: 'La Paz' }],
  ] as const)('past DRAFT (%s): a material change %j needs a review and nothing is published', async (status, patch) => {
    const { service, repository, users } = setup(status);
    await expect(service.updateProfile(actor, patch)).rejects.toMatchObject({ code: 'BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW', status: 409 });
    expect(repository.updateEntity).not.toHaveBeenCalled();
    expect(repository.findNameHolder).not.toHaveBeenCalled();
    expect(users.updateFullName).not.toHaveBeenCalled();
  });

  it('past DRAFT: non-material fields, and the current name and category sent again, publish at once', async () => {
    const { service, repository, users } = setup('ACTIVE');
    await service.updateProfile(actor, { name: 'Top Fit', primaryCategoryId: 'cat-1', city: 'La Paz' });
    expect(repository.updateEntity).toHaveBeenCalledWith(expect.anything(), { name: 'Top Fit', primaryCategoryId: 'cat-1', city: 'La Paz' }, {});
    expect(repository.findNameHolder).not.toHaveBeenCalled();
    expect(users.updateFullName).not.toHaveBeenCalled();
  });
});

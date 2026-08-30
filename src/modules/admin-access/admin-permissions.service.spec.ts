import { NotFoundException } from '@nestjs/common';
import { AdminPermissionKey } from './admin-permission.catalog';
import { AdminPermissionsService } from './admin-permissions.service';

describe('AdminPermissionsService', () => {
  const buildService = () => {
    const repository = {
      findActiveGrantsForUser: jest.fn(),
      findGrantsForUser: jest.fn(),
      grant: jest.fn(),
      revoke: jest.fn(),
    };
    return { service: new AdminPermissionsService(repository as never), repository };
  };

  it('returns the active granted permission keys for a user', async () => {
    const { service, repository } = buildService();
    repository.findActiveGrantsForUser.mockResolvedValue([
      { permissionKey: AdminPermissionKey.CATALOG_READ },
      { permissionKey: AdminPermissionKey.QA_RUN },
    ]);

    const keys = await service.getPermissionKeysForUser('user-1');

    expect(keys).toEqual([AdminPermissionKey.CATALOG_READ, AdminPermissionKey.QA_RUN]);
    expect(repository.findActiveGrantsForUser).toHaveBeenCalledWith('user-1');
  });

  it('rejects granting a permission key that is not in the static catalog', async () => {
    const { service, repository } = buildService();

    await expect(
      service.grant('user-1', { permissionKey: 'not-a-real:permission', expiresAt: null }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.grant).not.toHaveBeenCalled();
  });

  it('grants a known permission key and returns the mapped grant', async () => {
    const { service, repository } = buildService();
    const grantedAt = new Date('2026-01-01T00:00:00.000Z');
    repository.grant.mockResolvedValue({
      id: 'grant-1',
      userId: 'user-1',
      permissionKey: AdminPermissionKey.QA_RUN,
      grantedByUserId: 'admin-1',
      grantedAt,
      expiresAt: null,
    });

    const result = await service.grant(
      'user-1',
      { permissionKey: AdminPermissionKey.QA_RUN, expiresAt: null },
      'admin-1',
    );

    expect(repository.grant).toHaveBeenCalledWith('user-1', AdminPermissionKey.QA_RUN, 'admin-1', null);
    expect(result).toEqual({
      id: 'grant-1',
      userId: 'user-1',
      permissionKey: AdminPermissionKey.QA_RUN,
      grantedByUserId: 'admin-1',
      grantedAt,
      expiresAt: null,
    });
  });

  it('throws NotFoundException when revoking a permission the user does not have', async () => {
    const { service, repository } = buildService();
    repository.revoke.mockResolvedValue(false);

    await expect(service.revoke('user-1', AdminPermissionKey.QA_RUN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

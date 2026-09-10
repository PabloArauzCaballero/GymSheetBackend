import { NotFoundException } from '@nestjs/common';
import { env } from '../../config/env';
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
    // Por defecto la cuenta destinataria vive en el mismo gimnasio que quien
    // concede; los casos fuera de alcance lo sobrescriben.
    const usersRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'user-1', tenantId: 'topfitness' }),
    };
    return {
      service: new AdminPermissionsService(repository as never, usersRepository as never),
      repository,
      usersRepository,
    };
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
      service.grant(
        'user-1',
        { permissionKey: 'not-a-real:permission', expiresAt: null },
        'admin-1',
        'topfitness',
      ),
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
      'topfitness',
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

    await expect(
      service.revoke('user-1', AdminPermissionKey.QA_RUN, 'topfitness'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('alcance entre gimnasios', () => {
    /**
     * El identificador de la ruta era una llave: sin esta comprobación un
     * administrador concedía permisos de administración a una cuenta de otro
     * gimnasio. No es una fuga de lectura — es una escalada que sobrevive a la
     * sesión, porque la concesión queda guardada.
     */
    it('no concede permisos a una cuenta de otro gimnasio', async () => {
      const { service, repository, usersRepository } = buildService();
      usersRepository.findById.mockResolvedValue({ id: 'user-1', tenantId: 'gimnasio-vecino' });

      await expect(
        service.grant(
          'user-1',
          { permissionKey: AdminPermissionKey.QA_RUN, expiresAt: null },
          'admin-1',
          'topfitness',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.grant).not.toHaveBeenCalled();
    });

    it('no revoca ni lista permisos de una cuenta de otro gimnasio', async () => {
      const { service, repository, usersRepository } = buildService();
      usersRepository.findById.mockResolvedValue({ id: 'user-1', tenantId: 'gimnasio-vecino' });

      await expect(
        service.revoke('user-1', AdminPermissionKey.QA_RUN, 'topfitness'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listGrantsForUser('user-1', 'topfitness')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.revoke).not.toHaveBeenCalled();
      expect(repository.findGrantsForUser).not.toHaveBeenCalled();
    });

    /**
     * Una cuenta anterior a la multi-marca no tiene gimnasio guardado y cae en
     * el de referencia. Si esta comprobacion tratara el nulo como «ninguno», el
     * administrador del gimnasio por defecto no podria administrar a sus
     * propios socios mas antiguos.
     */
    it('trata una cuenta sin gimnasio como del gimnasio de referencia', async () => {
      const { service, repository, usersRepository } = buildService();
      usersRepository.findById.mockResolvedValue({ id: 'user-1', tenantId: null });
      repository.findGrantsForUser.mockResolvedValue([]);

      await expect(
        service.listGrantsForUser('user-1', env.DEFAULT_TENANT_ID),
      ).resolves.toEqual([]);
    });

    /** La plataforma sin suplantar alcanza cualquier gimnasio. */
    it('deja a la plataforma administrar cualquier cuenta', async () => {
      const { service, repository, usersRepository } = buildService();
      usersRepository.findById.mockResolvedValue({ id: 'user-1', tenantId: 'gimnasio-vecino' });
      repository.findGrantsForUser.mockResolvedValue([]);

      await expect(service.listGrantsForUser('user-1', null)).resolves.toEqual([]);
    });
  });
});

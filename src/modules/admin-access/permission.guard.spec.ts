import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { AdminPermissionKey } from './admin-permission.catalog';
import { PermissionGuard } from './permission.guard';

describe('PermissionGuard', () => {
  const buildContext = (user: { id: string; role: UserRole } | undefined): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as never;

  const buildGuard = (requiredPermissions: string[] | undefined, grantedKeys: string[]) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requiredPermissions) };
    const adminPermissionsService = {
      getPermissionKeysForUser: jest.fn().mockResolvedValue(grantedKeys),
    };
    return new PermissionGuard(reflector as never, adminPermissionsService as never);
  };

  it('allows the request through when no @RequirePermission metadata is present', async () => {
    const guard = buildGuard(undefined, []);

    await expect(guard.canActivate(buildContext({ id: 'user-1', role: UserRole.ADMIN }))).resolves.toBe(
      true,
    );
  });

  it('rejects an unauthenticated request when a permission is required', async () => {
    const guard = buildGuard([AdminPermissionKey.QA_RUN], []);

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a user who lacks the required permission', async () => {
    const guard = buildGuard([AdminPermissionKey.QA_ADMIN], [AdminPermissionKey.QA_RUN]);

    await expect(
      guard.canActivate(buildContext({ id: 'user-1', role: UserRole.FRONT_DESK })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a user who holds every required permission', async () => {
    const guard = buildGuard(
      [AdminPermissionKey.QA_RUN, AdminPermissionKey.QA_READ],
      [AdminPermissionKey.QA_READ, AdminPermissionKey.QA_RUN],
    );

    await expect(
      guard.canActivate(buildContext({ id: 'user-1', role: UserRole.ADMIN })),
    ).resolves.toBe(true);
  });

  /**
   * El super-admin satisface el piso de permisos igual que satisface el de rol
   * en `RolesGuard`. Sin esto pasaba el primer filtro y chocaba con el segundo
   * en la misma ruta, así que la consola de sistema sólo funcionaba si alguien
   * le concedía a mano el catálogo entero.
   */
  it('allows SYSTEM_ADMIN without consulting the grant table', async () => {
    const guard = buildGuard([AdminPermissionKey.USERS_DANGER], []);
    const adminPermissionsService = (
      guard as unknown as {
        adminPermissionsService: { getPermissionKeysForUser: jest.Mock };
      }
    ).adminPermissionsService;

    await expect(
      guard.canActivate(buildContext({ id: 'root-1', role: UserRole.SYSTEM_ADMIN })),
    ).resolves.toBe(true);
    // No basta con que pase: si consultara las concesiones, un super-admin sin
    // filas seguiría entrando por la rama equivocada y el día que alguien
    // borrara el atajo nadie se enteraría hasta producción.
    expect(adminPermissionsService.getPermissionKeysForUser).not.toHaveBeenCalled();
  });
});

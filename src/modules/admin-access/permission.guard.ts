import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permission.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminPermissionsService } from './admin-permissions.service';

/**
 * Runs after RolesGuard. A route without `@RequirePermission()` is unaffected
 * (mirrors RolesGuard's no-metadata short-circuit) — this only tightens the
 * floor for routes that opt in to granular admin permissions.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminPermissionsService: AdminPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const authenticatedUser = request.user;

    if (!authenticatedUser) {
      throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }

    /**
     * `SYSTEM_ADMIN` satisface cualquier permiso, igual que satisface cualquier
     * ruta de `ADMIN` en `RolesGuard`.
     *
     * Sin esto el rol queda incoherente consigo mismo: pasa el filtro de rol y
     * choca contra el de permiso en la misma ruta, así que la consola de
     * sistema sólo funcionaría si alguien se acuerda de concederle a mano las
     * veintiuna llaves del catálogo —y de conceder cada llave nueva que se
     * añada después. Un privilegio que depende de que nadie olvide un paso
     * manual es un privilegio que se rompe.
     *
     * Se resuelve por rol y no sembrando concesiones por la misma razón que
     * `RolesGuard.satisfies`: las concesiones son para acotar a un equipo con
     * responsabilidades repartidas, y el super-admin no es parte de ese equipo.
     */
    if (authenticatedUser.role === UserRole.SYSTEM_ADMIN) {
      return true;
    }

    const grantedKeys = await this.adminPermissionsService.getPermissionKeysForUser(
      authenticatedUser.id,
    );
    const hasAllRequiredPermissions = requiredPermissions.every((permission) =>
      grantedKeys.includes(permission),
    );

    if (!hasAllRequiredPermissions) {
      throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }

    return true;
  }
}

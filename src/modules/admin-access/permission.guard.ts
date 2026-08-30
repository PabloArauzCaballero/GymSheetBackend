import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permission.decorator';
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

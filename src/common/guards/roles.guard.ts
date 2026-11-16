import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/domain.enums';
import { AuthenticatedUser } from '../types/auth-context.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const authenticatedUser = request.user;

    if (!authenticatedUser || !this.satisfies(authenticatedUser.role, requiredRoles)) {
      throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }

    return true;
  }

  /**
   * Legacy shortcut: `SYSTEM_ADMIN` satisfies a route open to `ADMIN`. Since
   * franja 7a (ADR-0019) no route declares `ADMIN` any more —every `admin/*`
   * route names `SYSTEM_ADMIN` (or the moderation roles) explicitly, which
   * `roles.guard.admin-routes.spec.ts` enforces— and the shortcut goes away
   * with the staff roles in franja 7d.
   *
   * It deliberately does NOT satisfy other roles: a `SYSTEM_ADMIN` is not a
   * `COACH` nor a `CLIENTE`, and those routes assume data of their own.
   */
  private satisfies(role: UserRole, requiredRoles: UserRole[]): boolean {
    if (requiredRoles.includes(role)) {
      return true;
    }

    return (
      role === UserRole.SYSTEM_ADMIN && requiredRoles.includes(UserRole.ADMIN)
    );
  }
}

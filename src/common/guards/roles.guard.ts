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
   * `SYSTEM_ADMIN` es un `ADMIN` que además cruza gimnasios, así que satisface
   * cualquier ruta abierta a `ADMIN`.
   *
   * Se resuelve aquí y no añadiéndolo a los `@Roles()` de los once módulos
   * administrativos: enumerarlo en cada decorador significa que la próxima ruta
   * que alguien escriba se olvidará de incluirlo, y el fallo —un super-admin
   * que no puede entrar donde debería— aparecería en producción y no aquí.
   *
   * Deliberadamente NO satisface roles que no sean `ADMIN`: un `SYSTEM_ADMIN`
   * no es un `COACH` ni un `CLIENTE`, y las rutas de esos roles asumen datos
   * propios (rutinas asignadas, progresión) que él no tiene.
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

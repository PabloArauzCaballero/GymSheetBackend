import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums/domain.enums';
import { AuthenticatedUser } from '../types/auth-context.types';
import { RolesGuard } from './roles.guard';

function createContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function createGuard(requiredRoles: UserRole[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

const clientUser: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'client@example.test',
  role: UserRole.CLIENT,
  tenantId: 'default',
  tenantScope: 'default',
  impersonating: false,
};

describe('RolesGuard', () => {
  it('denies a client reaching a route restricted to administrators', () => {
    const guard = createGuard([UserRole.ADMIN]);

    expect(() => guard.canActivate(createContext(clientUser))).toThrow(ForbiddenException);
  });

  it('denies an unauthenticated request to a role-restricted route', () => {
    // Defence in depth: if JwtAuthGuard were ever bypassed or reordered, a
    // request without a principal must still not satisfy a role requirement.
    const guard = createGuard([UserRole.ADMIN]);

    expect(() => guard.canActivate(createContext(undefined))).toThrow(ForbiddenException);
  });

  it('allows a user holding one of the required roles', () => {
    const guard = createGuard([UserRole.ADMIN, UserRole.CLIENT]);

    expect(guard.canActivate(createContext(clientUser))).toBe(true);
  });

  it('allows routes that declare no role requirement', () => {
    const guard = createGuard(undefined);

    expect(guard.canActivate(createContext(clientUser))).toBe(true);
  });

  it('treats an empty role list as no requirement rather than deny-all', () => {
    const guard = createGuard([]);

    expect(guard.canActivate(createContext(clientUser))).toBe(true);
  });
});

describe('RolesGuard — administrador de plataforma', () => {
  const systemAdmin: AuthenticatedUser = {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'platform@example.test',
    role: UserRole.SYSTEM_ADMIN,
    tenantId: 'default',
    tenantScope: null,
    impersonating: false,
  };

  function contextFor(user: AuthenticatedUser): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  it('entra en una ruta abierta a administradores de gimnasio', () => {
    const guard = createGuard([UserRole.ADMIN, UserRole.FRONT_DESK]);

    expect(guard.canActivate(contextFor(systemAdmin))).toBe(true);
  });

  /**
   * No es un atajo universal: las rutas de socio o de entrenador asumen datos
   * propios (rutinas asignadas, progresión) que un administrador de plataforma
   * no tiene, y dejarle entrar produciría respuestas sin sentido en vez de un
   * permiso denegado claro.
   */
  it('no entra en una ruta que no admite administradores', () => {
    const guard = createGuard([UserRole.COACH]);

    expect(() => guard.canActivate(contextFor(systemAdmin))).toThrow(
      ForbiddenException,
    );
  });
});

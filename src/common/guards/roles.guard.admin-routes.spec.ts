import { ExecutionContext, ForbiddenException, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/domain.enums';
import { AuthenticatedUser } from '../types/auth-context.types';
import { RolesGuard } from './roles.guard';

/**
 * Franja 7a (ADR-0019): REPP operates the platform and the gym has no staff.
 * Every `admin/*` route declares platform roles only, so a member or a
 * business is refused by the guard itself, and the next route someone writes
 * is checked here without being listed by hand. Since franja 7d (ADR-0029)
 * the staff roles no longer exist and no route of any controller may name one.
 *
 * There is no exception any more: the owner-gated `admin/directory` console
 * was removed in franja 8d (ADR-0024), and a business manages its listing and
 * its orders under `business/me/*`.
 */
const PLATFORM_ROLES = new Set<UserRole>([UserRole.SYSTEM_ADMIN, UserRole.MODERATOR]);
/** Franja 7d (ADR-0029): the staff roles are gone; no route may name them again, even as a raw string. */
const REMOVED_ROLES = ['ADMIN', 'FRONT_DESK', 'COACH', 'ENTRENADOR_EXTERNO'];
const ROLES_IN_USE = new Set<string>(Object.values(UserRole));

type AdminRoute = { name: string; path: string; controller: Type; handler: (...args: unknown[]) => unknown };

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

async function collectRoutes(): Promise<AdminRoute[]> {
  const routes: AdminRoute[] = [];
  for (const file of controllerFiles(join(__dirname, '..', '..', 'modules'))) {
    const exported = (await import(file)) as Record<string, unknown>;
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as Type;
      const path: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (typeof path !== 'string') continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        routes.push({ name: `${path} ${key}`, path, controller, handler: handler as AdminRoute['handler'] });
      }
    }
  }
  return routes;
}

function principal(role: UserRole): AuthenticatedUser {
  return {
    id: '00000000-0000-4000-8000-000000000071',
    email: 'staff@example.test',
    role,
    tenantId: 'gym-a',
    tenantScope: role === UserRole.SYSTEM_ADMIN ? null : 'gym-a',
    impersonating: false,
  };
}

function contextFor(route: AdminRoute, user: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => route.handler,
    getClass: () => route.controller,
  } as unknown as ExecutionContext;
}

describe('RolesGuard — admin/* is platform only (franja 7a)', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  let everyRoute: AdminRoute[];
  let routes: AdminRoute[];
  const rolesOf = (route: AdminRoute) =>
    reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [route.handler, route.controller]) ?? [];

  beforeAll(async () => {
    everyRoute = await collectRoutes();
    routes = everyRoute.filter((route) => route.path.startsWith('admin/'));
  });

  it('no route of any controller declares a removed staff role or an unknown one (franja 7d)', () => {
    expect(everyRoute.length).toBeGreaterThan(routes.length);
    const offending = everyRoute
      .map((route) => ({ name: route.name, roles: rolesOf(route) }))
      .filter(({ roles }) => roles.some((role) => REMOVED_ROLES.includes(role) || !ROLES_IN_USE.has(role)));
    expect(offending).toEqual([]);
    expect(REMOVED_ROLES.filter((role) => ROLES_IN_USE.has(role))).toEqual([]);
  });

  it('finds the admin routes it is meant to guard', () => {
    // Without this a renamed directory would leave the checks below passing on an empty list.
    // `admin/membership/*` and `admin/access/*` left the product with franja 8e (ADR-0026).
    expect(routes.length).toBeGreaterThan(80);
  });

  it('every admin/* route declares only platform roles', () => {
    const offending = routes
      .map((route) => ({
        name: route.name,
        roles: reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [route.handler, route.controller]),
      }))
      .filter(({ roles }) => !roles?.length || roles.some((role) => !PLATFORM_ROLES.has(role)));
    expect(offending).toEqual([]);
  });

  it.each([UserRole.CLIENT, UserRole.BUSINESS])('a %s account is refused on every admin/* route', (role) => {
    const admitted = routes.filter((route) => {
      try {
        return guard.canActivate(contextFor(route, principal(role)));
      } catch (error) {
        if (error instanceof ForbiddenException) return false;
        throw error;
      }
    });
    expect(admitted.map((route) => route.name)).toEqual([]);
  });

  it('SYSTEM_ADMIN enters every admin/* route', () => {
    for (const route of routes) {
      expect(guard.canActivate(contextFor(route, principal(UserRole.SYSTEM_ADMIN)))).toBe(true);
    }
  });
});

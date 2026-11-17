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
 * Every `admin/*` route declares platform roles only, so a legacy gym
 * `ADMIN`/`FRONT_DESK`/`COACH` is refused by the guard itself, and the next
 * route someone writes is checked here without being listed by hand.
 *
 * There is no exception any more: the owner-gated `admin/directory` console
 * was removed in franja 8d (ADR-0024), and a business manages its listing and
 * its orders under `business/me/*`.
 */
const PLATFORM_ROLES = new Set<UserRole>([UserRole.SYSTEM_ADMIN, UserRole.MODERATOR]);
const LEGACY_STAFF = [UserRole.ADMIN, UserRole.FRONT_DESK, UserRole.COACH, UserRole.EXTERNAL_TRAINER];

type AdminRoute = { name: string; controller: Type; handler: (...args: unknown[]) => unknown };

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

async function collectAdminRoutes(): Promise<AdminRoute[]> {
  const routes: AdminRoute[] = [];
  for (const file of controllerFiles(join(__dirname, '..', '..', 'modules'))) {
    const exported = (await import(file)) as Record<string, unknown>;
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as Type;
      const path: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (typeof path !== 'string' || !path.startsWith('admin/')) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        routes.push({ name: `${path} ${key}`, controller, handler: handler as AdminRoute['handler'] });
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
  let routes: AdminRoute[];

  beforeAll(async () => {
    routes = await collectAdminRoutes();
  });

  it('finds the admin routes it is meant to guard', () => {
    // Without this a renamed directory would leave the checks below passing on an empty list.
    expect(routes.length).toBeGreaterThan(100);
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

  it.each(LEGACY_STAFF)('a legacy gym %s is refused on every admin/* route', (role) => {
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

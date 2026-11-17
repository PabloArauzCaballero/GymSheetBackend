import { RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { IS_PUBLIC_ROUTE_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/domain.enums';
import { accountKindMayReach } from './account-kind.guard';

/**
 * Route inventory (ADR-0020). Every controller route is discovered from the
 * Nest metadata; the routes a business account can actually reach (not
 * public, allowed by `AccountKindGuard`, and either without `@Roles` or with
 * `BUSINESS` in it) must be EXACTLY this list. A new route that a business
 * could reach fails here until someone decides it belongs to businesses.
 */
const BUSINESS_REACHABLE: string[] = [
  // Session, email PIN and devices.
  'DELETE business/me/media/:slot',
  'DELETE me/devices/:id',
  'DELETE notifications/device-tokens',
  'GET auth/me',
  'GET business/me',
  'GET me/devices',
  'GET me/legal/pending',
  'GET notifications/me',
  'GET notifications/me/unread-count',
  'GET notifications/preferences/me',
  'GET notifications/push/web-config',
  'PATCH business/me/profile',
  'PATCH notifications/:id/read',
  'PATCH notifications/preferences/me',
  'POST auth/email/verify/confirm',
  'POST auth/email/verify/request',
  'POST business/me/media',
  'POST me/devices/revoke-others',
  'POST me/legal/accept',
  'POST notifications/device-tokens',
  'PUT business/me/handle',
  // KYC of the business (ADR-0021, franja 8b).
  'DELETE business/me/kyc/documents/:id',
  'GET business/me/kyc',
  'POST business/me/kyc/changes',
  'POST business/me/kyc/documents',
  'POST business/me/kyc/resubmit',
  'POST business/me/kyc/selfie-challenge',
  'POST business/me/kyc/submit',
  'POST business/me/phone/verify/confirm',
  'POST business/me/phone/verify/request',
  'PUT business/me/kyc/consent',
  'PUT business/me/kyc/draft',
  // Listings, locations and gallery of the business (ADR-0022, franja 8c).
  'DELETE business/me/gallery/:position',
  'DELETE business/me/listings/:id/media/:position',
  'DELETE business/me/locations/:id',
  'GET business/me/listings',
  'GET business/me/listings/:id',
  'GET business/me/locations',
  'PATCH business/me/listings/:id',
  'PATCH business/me/listings/:id/price',
  'PATCH business/me/listings/:id/stock',
  'PATCH business/me/locations/:id',
  'POST business/me/gallery',
  'POST business/me/listings',
  'POST business/me/listings/:id/archive',
  'POST business/me/listings/:id/media',
  'POST business/me/listings/:id/pause',
  'POST business/me/listings/:id/resume',
  'POST business/me/locations',
];

type Route = { method: string; path: string; controller: Type; handler: object };

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

function joinPath(...parts: unknown[]): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : ''))
    .join('/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

async function collectRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of controllerFiles(join(__dirname, '..', '..', 'modules'))) {
    for (const candidate of Object.values((await import(file)) as Record<string, unknown>)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as Type;
      const base: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (base === undefined) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const path = joinPath(base, Reflect.getMetadata(PATH_METADATA, handler));
        routes.push({ method: RequestMethod[method as RequestMethod], path, controller, handler });
      }
    }
  }
  return routes;
}

describe('route inventory: what a business account can reach (ADR-0020)', () => {
  const reflector = new Reflector();
  let routes: Route[];

  beforeAll(async () => {
    routes = await collectRoutes();
  });

  const targets = (route: Route) => [route.handler as () => void, route.controller];
  const isPublic = (route: Route) => reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, targets(route)) === true;
  const roles = (route: Route) => reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets(route));

  it('finds the routes it is meant to guard', () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it('a business reaches exactly the decided routes', () => {
    const reachable = routes
      .filter((route) => !isPublic(route))
      .filter((route) => accountKindMayReach('BUSINESS', `${route.path}/`))
      .filter((route) => !roles(route)?.length || roles(route)?.includes(UserRole.BUSINESS))
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(reachable).toEqual([...BUSINESS_REACHABLE].sort());
  });

  it('every non-public business/* route is for business accounts only', () => {
    const offending = routes
      .filter((route) => route.path.startsWith('business/') && !isPublic(route))
      .filter((route) => JSON.stringify(roles(route)) !== JSON.stringify([UserRole.BUSINESS]))
      .map((route) => `${route.method} ${route.path}`);
    expect(offending).toEqual([]);
  });

  it('a person is refused on every business/* route', () => {
    const open = routes
      .filter((route) => route.path.startsWith('business/') && !isPublic(route))
      .filter((route) => accountKindMayReach('PERSON', `${route.path}/`));
    expect(open).toEqual([]);
  });
});

import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { env } from '../../config/env';
import { DomainException } from '../errors/domain.exception';
import { AccountKind, AuthenticatedUser, accountKindOf } from '../types/auth-context.types';

/**
 * Route prefixes (after the API prefix) a business account may reach
 * (ADR-0020). Everything else is a person's surface: profile, social,
 * discovery, training, community, chat and the admin consoles.
 *
 * Chat with persons (`me/conversations`, ADR-0023) is open to a business: it
 * reads and answers the conversations persons opened with it. The socket
 * ticket and closing or exporting the account (`me/account`, `me/export`)
 * stay refused until they are decided for businesses.
 */
const BUSINESS_ALLOWED_PREFIXES = [
  'auth/',
  'legal/',
  'me/legal/',
  'me/devices/',
  'health/',
  'business/',
  'me/conversations/',
  'public/',
  'notifications/me/',
  'notifications/preferences/me/',
  'notifications/push/',
  'notifications/device-tokens/',
] as const;

/** Read-receipt style routes with a parameter in the middle: `notifications/:id/read`. */
const BUSINESS_ALLOWED_PATTERNS = [/^notifications\/[^/]+\/read\/$/u] as const;

/** Under an allowed prefix but still a person's surface (matches pending replies of social matches too). */
const BUSINESS_DENIED_UNDER_ALLOWED = ['auth/socket-ticket/', 'me/conversations/pending-replies/'] as const;

/** Exact `METHOD path/` refusals: a business only answers, it never opens a conversation (ADR-0023). */
const BUSINESS_DENIED_ROUTES = ['POST me/conversations/'] as const;

/** Only business accounts enter here; `business/signup` is public and never reaches the guard with a user. */
const BUSINESS_ONLY_PREFIX = 'business/';

export const ACCOUNT_KIND_NOT_ALLOWED_MESSAGE = 'Esta función no está disponible para este tipo de cuenta.';

/** Path relative to the API prefix, always ending in `/`, so prefixes match whole segments. */
export function relativeRoutePath(path: string, apiPrefix: string = env.API_PREFIX): string {
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\/+/, '');
  return relative.endsWith('/') ? relative : `${relative}/`;
}

/** Whether an account of `kind` may call `method` on `relativePath` (as returned by `relativeRoutePath`). */
export function accountKindMayReach(kind: AccountKind, relativePath: string, method: string): boolean {
  if (kind === 'PERSON') return !relativePath.startsWith(BUSINESS_ONLY_PREFIX);
  if (BUSINESS_DENIED_UNDER_ALLOWED.some((denied) => relativePath.startsWith(denied))) return false;
  if ((BUSINESS_DENIED_ROUTES as readonly string[]).includes(`${method.toUpperCase()} ${relativePath}`)) return false;
  return (
    BUSINESS_ALLOWED_PREFIXES.some((allowed) => relativePath.startsWith(allowed)) ||
    BUSINESS_ALLOWED_PATTERNS.some((pattern) => pattern.test(relativePath))
  );
}

/**
 * Deny-by-default for business accounts (ADR-0020). `RolesGuard` lets any
 * authenticated account into a route without `@Roles`, so without this a
 * business could use `/me/profile`, social or discovery. In the other
 * direction a person never enters `business/*`. Both are function-level
 * refusals (BFLA): 403 `ACCOUNT_KIND_NOT_ALLOWED`; horizontal access stays 404.
 *
 * The kind comes from the role, which `JwtStrategy` re-reads from the database
 * on every request. Public routes carry no user and are not affected.
 */
@Injectable()
export class AccountKindGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) return true;
    if (accountKindMayReach(accountKindOf(request.user.role), relativeRoutePath(request.path), request.method)) return true;
    throw new DomainException(HttpStatus.FORBIDDEN, 'ACCOUNT_KIND_NOT_ALLOWED', ACCOUNT_KIND_NOT_ALLOWED_MESSAGE);
  }
}

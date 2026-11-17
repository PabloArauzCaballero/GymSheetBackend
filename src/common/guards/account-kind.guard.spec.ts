import { ExecutionContext } from '@nestjs/common';
import { UserRole } from '../enums/domain.enums';
import { AuthenticatedUser } from '../types/auth-context.types';
import { AccountKindGuard, accountKindMayReach, relativeRoutePath } from './account-kind.guard';

function contextFor(path: string, user?: Partial<AuthenticatedUser>, method = 'GET'): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ path, user, method }) }),
  } as unknown as ExecutionContext;
}

describe('AccountKindGuard (ADR-0020)', () => {
  const guard = new AccountKindGuard();
  const business = { id: 'b', role: UserRole.BUSINESS };
  const person = { id: 'p', role: UserRole.CLIENT };

  it('normalizes the path relative to the API prefix', () => {
    expect(relativeRoutePath('/api/v1/business/me', 'api/v1')).toBe('business/me/');
    expect(relativeRoutePath('/api/v1/me/profile/', 'api/v1')).toBe('me/profile/');
  });

  it.each(['/api/v1/me/profile', '/api/v1/me/social-profile', '/api/v1/me/discovery/deck', '/api/v1/me/gym-directory',
    '/api/v1/me/conversations/pending-replies', '/api/v1/me/business-conversations', '/api/v1/auth/socket-ticket', '/api/v1/admin/directory/entities/x/plans',
    '/api/v1/directory/entities', '/api/v1/me/account/close', '/api/v1/workouts', '/api/v1/me/legalities'])(
    'refuses a business on %s with 403 ACCOUNT_KIND_NOT_ALLOWED',
    (path) => {
      expect(() => guard.canActivate(contextFor(path, business))).toThrow(
        expect.objectContaining({ code: 'ACCOUNT_KIND_NOT_ALLOWED' }),
      );
    },
  );

  it.each(['/api/v1/business/me', '/api/v1/auth/me', '/api/v1/auth/email/verify/confirm', '/api/v1/legal/current',
    '/api/v1/me/legal/accept', '/api/v1/public/handles/x', '/api/v1/notifications/me', '/api/v1/notifications/abc/read',
    '/api/v1/me/devices', '/api/v1/me/conversations', '/api/v1/me/conversations/c1/messages'])('lets a business reach %s', (path) => {
    expect(guard.canActivate(contextFor(path, business))).toBe(true);
  });

  it('a business answers but never opens a conversation (ADR-0023)', () => {
    expect(guard.canActivate(contextFor('/api/v1/me/conversations/c1/messages', business, 'POST'))).toBe(true);
    expect(() => guard.canActivate(contextFor('/api/v1/me/conversations', business, 'POST'))).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_KIND_NOT_ALLOWED' }),
    );
    expect(guard.canActivate(contextFor('/api/v1/me/conversations', person, 'POST'))).toBe(true);
  });

  it('refuses a person on business/*', () => {
    expect(() => guard.canActivate(contextFor('/api/v1/business/me', person))).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_KIND_NOT_ALLOWED' }),
    );
    expect(accountKindMayReach('PERSON', 'businesses/', 'GET')).toBe(true);
    expect(guard.canActivate(contextFor('/api/v1/me/profile', person))).toBe(true);
  });

  it('does not act on public routes (no user)', () => {
    expect(guard.canActivate(contextFor('/api/v1/me/profile'))).toBe(true);
  });
});

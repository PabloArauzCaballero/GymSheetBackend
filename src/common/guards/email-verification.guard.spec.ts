import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException } from '../errors/domain.exception';
import { EmailVerificationGuard } from './email-verification.guard';

function contextFor(user: { emailVerified?: boolean } | undefined, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guard(required: boolean | undefined): EmailVerificationGuard {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
  return new EmailVerificationGuard(reflector);
}

describe('EmailVerificationGuard', () => {
  it('leaves unmarked routes alone, verified or not', () => {
    expect(guard(undefined).canActivate(contextFor({ emailVerified: false }))).toBe(true);
  });

  it('lets a verified account through a social route', () => {
    expect(guard(true).canActivate(contextFor({ emailVerified: true }))).toBe(true);
  });

  it.each([
    ['an unverified account', { emailVerified: false }],
    ['a principal without the flag', {}],
    ['no principal at all', undefined],
  ])('answers 403 EMAIL_VERIFICATION_REQUIRED for %s', (_label, user) => {
    let error: unknown;
    try {
      guard(true).canActivate(contextFor(user));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).getStatus()).toBe(403);
    expect((error as DomainException).code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  it('does not interfere with non-HTTP contexts (sockets enforce it themselves)', () => {
    expect(guard(true).canActivate(contextFor({ emailVerified: false }, 'ws'))).toBe(true);
  });
});

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

const context = {
  getHandler: () => undefined,
  getClass: () => undefined,
} as unknown as ExecutionContext;

function createGuard(isPublicRoute: boolean | undefined): JwtAuthGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublicRoute),
  } as unknown as Reflector;
  return new JwtAuthGuard(reflector);
}

describe('JwtAuthGuard', () => {
  it('short-circuits authentication only for routes marked public', () => {
    const guard = createGuard(true);

    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([
    ['absent metadata', undefined],
    ['metadata explicitly false', false],
  ])('delegates to passport authentication when %s', (_label, isPublicRoute) => {
    // The guard is registered globally, so anything that is not explicitly
    // public must reach the passport strategy rather than being waved through.
    // Deferring to `super.canActivate` is the observable contract here.
    const guard = createGuard(isPublicRoute);
    const delegated = Symbol('passport-result');
    const superCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype) as JwtAuthGuard, 'canActivate')
      .mockReturnValue(delegated as never);

    expect(guard.canActivate(context)).toBe(delegated);
    expect(superCanActivate).toHaveBeenCalledTimes(1);

    superCanActivate.mockRestore();
  });
});

import { ExecutionContext, CallHandler } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  const actor: AuthenticatedUser = {
    id: 'actor-1',
    email: 'admin@gym.test',
    role: UserRole.ADMIN,
    tenantId: 'topfitness',
    tenantScope: 'topfitness',
    impersonating: false,
  };

  function build(
    metadata: Record<string, unknown> | undefined,
    options: {
      user?: AuthenticatedUser;
      params?: Record<string, string>;
      userAgent?: string;
    } = {},
  ) {
    const record = jest.fn().mockResolvedValue(undefined);
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(metadata) };
    const interceptor = new AuditInterceptor(reflector as never, { record } as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: 'user' in options ? options.user : actor,
          params: options.params ?? {},
          ip: '203.0.113.7',
          get: (header: string) =>
            header === 'user-agent' ? options.userAgent : undefined,
        }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    return { interceptor, context, record };
  }

  const okHandler: CallHandler = { handle: () => of({ ok: true }) };

  it('does nothing for a route without @Audited', async () => {
    const { interceptor, context, record } = build(undefined);

    await lastValueFrom(interceptor.intercept(context, okHandler));

    expect(record).not.toHaveBeenCalled();
  });

  it('records the action with the target read from the route parameter', async () => {
    const { interceptor, context, record } = build(
      { domain: 'users', action: 'deactivate', targetKind: 'user', targetParam: 'userId' },
      { params: { userId: 'target-9' }, userAgent: 'Mozilla/5.0' },
    );

    await lastValueFrom(interceptor.intercept(context, okHandler));

    expect(record).toHaveBeenCalledWith(actor, {
      domain: 'users',
      action: 'deactivate',
      targetKind: 'user',
      targetId: 'target-9',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });

  /**
   * Lo que distingue un historial útil de una lista de ruido: un intento que
   * el guard rechazó, o que reventó a mitad, no dejó nada hecho y no debe
   * figurar como acción ejecutada.
   */
  it('records nothing when the handler fails', async () => {
    const { interceptor, context, record } = build({
      domain: 'users',
      action: 'deactivate',
    });
    const failing: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(
      lastValueFrom(interceptor.intercept(context, failing)),
    ).rejects.toThrow('boom');
    expect(record).not.toHaveBeenCalled();
  });

  it('skips the write when there is no authenticated actor', async () => {
    const { interceptor, context, record } = build(
      { domain: 'users', action: 'deactivate' },
      { user: undefined },
    );

    await lastValueFrom(interceptor.intercept(context, okHandler));

    expect(record).not.toHaveBeenCalled();
  });

  it('truncates an oversized user agent instead of failing the write', async () => {
    const { interceptor, context, record } = build(
      { domain: 'files', action: 'download' },
      { userAgent: 'x'.repeat(900) },
    );

    await lastValueFrom(interceptor.intercept(context, okHandler));

    expect(record.mock.calls[0][1].userAgent).toHaveLength(500);
  });
});

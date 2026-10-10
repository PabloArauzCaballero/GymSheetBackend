import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  const gymAdmin: AuthenticatedUser = {
    id: 'actor-1',
    email: 'admin@gym.test',
    role: UserRole.ADMIN,
    tenantId: 'topfitness',
    tenantScope: 'topfitness',
    impersonating: false,
  };

  const systemAdmin: AuthenticatedUser = {
    id: 'root-1',
    email: 'root@gymsheet.test',
    role: UserRole.SYSTEM_ADMIN,
    tenantId: 'default',
    tenantScope: null,
    impersonating: false,
  };

  function build(rows: unknown[] = []) {
    const repository = {
      record: jest.fn().mockResolvedValue(undefined),
      findPage: jest.fn().mockResolvedValue(rows),
    };
    return { service: new AuditLogService(repository as never), repository };
  }

  function row(id: string, occurredAt: string) {
    return {
      id,
      occurredAt: new Date(occurredAt),
      actorUserId: 'actor-1',
      actorEmail: 'admin@gym.test',
      actorRole: 'ADMIN',
      tenantScope: 'topfitness',
      domain: 'users',
      action: 'deactivate',
      targetKind: 'user',
      targetId: 'target-9',
      metadata: {},
    };
  }

  describe('record', () => {
    it('stores the scope the action landed on, not the actor tenant', async () => {
      const { service, repository } = build();

      await service.record(systemAdmin, {
        domain: 'users',
        action: 'deactivate',
        targetKind: 'user',
        targetId: 'target-9',
        ip: null,
        userAgent: null,
      });

      expect(repository.record).toHaveBeenCalledWith(
        expect.objectContaining({ tenantScope: null, actorRole: UserRole.SYSTEM_ADMIN }),
      );
    });

    it('flags impersonation in the metadata', async () => {
      const { service, repository } = build();

      await service.record(
        { ...systemAdmin, tenantScope: 'topfitness', impersonating: true },
        {
          domain: 'users',
          action: 'deactivate',
          targetKind: null,
          targetId: null,
          ip: null,
          userAgent: null,
        },
      );

      expect(repository.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantScope: 'topfitness',
          metadata: { impersonating: true },
        }),
      );
    });

    /**
     * La acción ya se aplicó y ya se respondió cuando esto corre: propagar el
     * fallo convertiría una operación exitosa en un error para quien la pidió,
     * sin deshacer nada.
     */
    it('never throws when the write fails', async () => {
      const { service, repository } = build();
      repository.record.mockRejectedValue(new Error('base de datos caída'));

      await expect(
        service.record(gymAdmin, {
          domain: 'users',
          action: 'deactivate',
          targetKind: null,
          targetId: null,
          ip: null,
          userAgent: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('filters by tenant for a gym admin', async () => {
      const { service, repository } = build();

      await service.list({ limit: 20 }, 'topfitness');

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 21 }),
        'topfitness',
      );
    });

    /**
     * `undefined` y `null` significan cosas distintas en el repositorio: el
     * primero es «sin filtro», el segundo es «filtra por las filas de
     * plataforma». Confundirlos dejaría al super-admin viendo sólo sus propias
     * acciones globales y ninguna de los gimnasios.
     */
    it('applies no tenant filter for a system admin', async () => {
      const { service, repository } = build();

      await service.list({ limit: 20 }, null);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
      );
    });

    it('returns no cursor when the page is the last one', async () => {
      const { service } = build([row('a', '2026-09-14T10:00:00.000Z')]);

      const page = await service.list({ limit: 20 }, 'topfitness');

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it('trims the extra probe row and returns a cursor when more remain', async () => {
      const { service } = build([
        row('c', '2026-09-14T12:00:00.000Z'),
        row('b', '2026-09-14T11:00:00.000Z'),
        row('a', '2026-09-14T10:00:00.000Z'),
      ]);

      const page = await service.list({ limit: 2 }, 'topfitness');

      expect(page.items.map((item) => item.id)).toEqual(['c', 'b']);
      expect(page.nextCursor).not.toBeNull();
    });

    it('round-trips its own cursor back into a keyset position', async () => {
      const { service, repository } = build([
        row('c', '2026-09-14T12:00:00.000Z'),
        row('b', '2026-09-14T11:00:00.000Z'),
      ]);

      const first = await service.list({ limit: 1 }, 'topfitness');
      await service.list({ limit: 1, cursor: first.nextCursor as string }, 'topfitness');

      expect(repository.findPage.mock.calls[1][0].cursor).toEqual({
        occurredAt: new Date('2026-09-14T12:00:00.000Z'),
        id: 'c',
      });
    });

    it('ignores a malformed cursor instead of failing the request', async () => {
      const { service, repository } = build();

      await service.list({ limit: 20, cursor: 'no-es-un-cursor' }, 'topfitness');

      expect(repository.findPage.mock.calls[0][0].cursor).toBeUndefined();
    });
  });
});

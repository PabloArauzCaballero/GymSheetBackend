import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ModerationService } from './moderation.service';
import {
  ModerationReason,
  ModerationResolution,
  ModerationTargetKind,
  StrikeKind,
} from './moderation.policy';

describe('ModerationService', () => {
  const reporter: AuthenticatedUser = {
    id: 'reporter-1',
    email: 'socia@gym.test',
    role: UserRole.CLIENT,
    tenantId: 'topfitness',
    tenantScope: 'topfitness',
    impersonating: false,
  };

  const moderator: AuthenticatedUser = {
    id: 'mod-1',
    email: 'admin@gym.test',
    role: UserRole.ADMIN,
    tenantId: 'topfitness',
    tenantScope: 'topfitness',
    impersonating: false,
  };

  function build(overrides: Partial<Record<string, unknown>> = {}) {
    const repository = {
      findContentOwner: jest
        .fn()
        .mockResolvedValue({ userId: 'author-1', tenantId: 'topfitness' }),
      createReport: jest.fn().mockResolvedValue({ id: 'report-1', status: 'PENDIENTE' }),
      countDistinctReporters: jest.fn().mockResolvedValue(1),
      setContentHidden: jest.fn().mockResolvedValue(undefined),
      findOpenReportsForTarget: jest.fn().mockResolvedValue([
        {
          id: 'report-1',
          reporterUserId: 'reporter-1',
          reportedUserId: 'author-1',
          tenantId: 'topfitness',
          reason: ModerationReason.CONTENIDO_SEXUAL,
        },
      ]),
      findReportsForTarget: jest.fn().mockResolvedValue([]),
      countActiveStrikes: jest.fn().mockResolvedValue(0),
      createStrike: jest.fn().mockResolvedValue({ id: 'strike-1' }),
      setSuspension: jest.fn().mockResolvedValue(undefined),
      resolveTarget: jest.fn().mockResolvedValue(1),
      claim: jest.fn().mockResolvedValue(1),
      release: jest.fn().mockResolvedValue(1),
      listStrikes: jest.fn().mockResolvedValue([]),
      findQueue: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
    const notifications = {
      enqueueDirectMessage: jest.fn().mockResolvedValue(true),
    };
    const sequelize = {
      transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) =>
        callback({}),
      ),
      query: jest.fn().mockResolvedValue([]),
    };
    const connections = { update: jest.fn().mockResolvedValue([1]) };
    const passes = { bulkCreate: jest.fn().mockResolvedValue([]) };

    const service = new ModerationService(
      sequelize as never,
      repository as never,
      notifications as never,
      connections as never,
      passes as never,
    );
    return { service, repository, notifications, connections, passes, sequelize };
  }

  const reportInput = {
    targetKind: ModerationTargetKind.STORY,
    targetId: 'story-1',
    reason: ModerationReason.CONTENIDO_SEXUAL,
    details: null,
  };

  describe('reportar', () => {
    it('rechaza contenido de otro gimnasio como si no existiera', async () => {
      const { service } = build({
        findContentOwner: jest
          .fn()
          .mockResolvedValue({ userId: 'author-1', tenantId: 'vecino' }),
      });

      // 404 y no 403: distinguirlos confirmaría identificadores ajenos.
      await expect(service.report(reporter, reportInput)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('no deja reportarse a uno mismo', async () => {
      const { service } = build({
        findContentOwner: jest
          .fn()
          .mockResolvedValue({ userId: reporter.id, tenantId: 'topfitness' }),
      });

      await expect(service.report(reporter, reportInput)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    /**
     * El patrón de Tinder: denunciar es también «no quiero volver a verlo».
     * Esperar a que un moderador resuelva para que deje de aparecer en la baraja
     * es la espera que hace que la gente abandone en vez de denunciar.
     */
    it('aparta a esa persona de la baraja y rompe la conexión', async () => {
      const { service, passes, connections } = build();

      await service.report(reporter, reportInput);

      expect(passes.bulkCreate).toHaveBeenCalledWith(
        [{ viewerId: 'reporter-1', targetId: 'author-1' }],
        expect.objectContaining({ ignoreDuplicates: true }),
      );
      expect(connections.update).toHaveBeenCalled();
    });

    it('no oculta nada mientras no se queje bastante gente distinta', async () => {
      const { service, repository } = build({
        countDistinctReporters: jest.fn().mockResolvedValue(2),
      });

      const result = await service.report(reporter, reportInput);

      expect(result.contentHidden).toBe(false);
      expect(repository.setContentHidden).not.toHaveBeenCalled();
    });

    it('oculta solo al alcanzar el umbral de denunciantes distintos', async () => {
      const { service, repository } = build({
        countDistinctReporters: jest.fn().mockResolvedValue(3),
      });

      const result = await service.report(reporter, reportInput);

      expect(result.contentHidden).toBe(true);
      expect(repository.setContentHidden).toHaveBeenCalledWith(
        expect.objectContaining({
          hidden: true,
          // Lo oculta el sistema: atribuírselo a una persona sería registrar una
          // decisión que nadie tomó, y un uuid inventado rompería la FK.
          moderatorUserId: null,
        }),
        expect.anything(),
      );
    });

    it('nunca auto-oculta a una persona, sólo contenido', async () => {
      const { service, repository } = build({
        countDistinctReporters: jest.fn().mockResolvedValue(10),
      });

      await service.report(reporter, {
        ...reportInput,
        targetKind: ModerationTargetKind.USER,
        targetId: 'author-1',
      });

      expect(repository.setContentHidden).not.toHaveBeenCalled();
    });

    /**
     * La denuncia ya está guardada cuando esto corre. Devolver un error porque
     * no se pudo romper una conexión perdería la denuncia a ojos de quien acaba
     * de reportar un acoso.
     */
    it('sigue adelante aunque no se pueda romper la conexión', async () => {
      const { service, connections } = build();
      connections.update.mockRejectedValue(new Error('base caída'));

      await expect(service.report(reporter, reportInput)).resolves.toMatchObject({
        id: 'report-1',
      });
    });
  });

  describe('resolver', () => {
    it('cierra el caso sin sancionar cuando se descarta', async () => {
      const { service, repository } = build();

      const result = await service.resolve(
        moderator,
        ModerationTargetKind.STORY,
        'story-1',
        { hideContent: false, sanction: false, note: null },
      );

      expect(repository.createStrike).not.toHaveBeenCalled();
      expect(result.sanction).toBeNull();
      expect(repository.resolveTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          discarded: true,
          resolution: ModerationResolution.SIN_ACCION,
        }),
        expect.anything(),
      );
    });

    it('retira contenido sin sancionar a nadie si es lo que se pide', async () => {
      const { service, repository } = build();

      await service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
        hideContent: true,
        sanction: false,
        note: null,
      });

      expect(repository.setContentHidden).toHaveBeenCalledWith(
        expect.objectContaining({ hidden: true, moderatorUserId: 'mod-1' }),
        expect.anything(),
      );
      expect(repository.createStrike).not.toHaveBeenCalled();
    });

    it('la primera falta es una advertencia y no suspende la cuenta', async () => {
      const { service, repository } = build({
        countActiveStrikes: jest.fn().mockResolvedValue(0),
      });

      const result = await service.resolve(
        moderator,
        ModerationTargetKind.STORY,
        'story-1',
        { hideContent: true, sanction: true, note: 'desnudo' },
      );

      expect(result.sanction).toMatchObject({ kind: StrikeKind.ADVERTENCIA });
      expect(repository.setSuspension).not.toHaveBeenCalled();
    });

    it('con dos faltas previas suspende siete días y lo aplica a la cuenta', async () => {
      const { service, repository } = build({
        countActiveStrikes: jest.fn().mockResolvedValue(3),
      });

      const result = await service.resolve(
        moderator,
        ModerationTargetKind.STORY,
        'story-1',
        { hideContent: true, sanction: true, note: null },
      );

      expect(result.sanction).toMatchObject({ kind: StrikeKind.SUSPENSION, days: 7 });
      expect(repository.setSuspension).toHaveBeenCalledWith(
        'author-1',
        expect.any(Date),
        expect.anything(),
      );
    });

    it('rechaza un caso que ya no está abierto', async () => {
      const { service } = build({
        findOpenReportsForTarget: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
          hideContent: false,
          sanction: false,
          note: null,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * Cierra el círculo: quien denuncia sabe que se revisó. Sin esto denunciar
     * se siente como escribir a un buzón que no contesta, y la gente deja de
     * hacerlo — la forma más barata de quedarse sin moderación.
     */
    it('avisa a quien denunció y a quien fue sancionado', async () => {
      const { service, notifications } = build({
        countActiveStrikes: jest.fn().mockResolvedValue(1),
      });

      await service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
        hideContent: true,
        sanction: true,
        note: null,
      });

      const recipients = (
        notifications.enqueueDirectMessage.mock.calls as [
          { recipientUserId: string },
        ][]
      ).map(([message]) => message.recipientUserId);
      expect(recipients).toContain('reporter-1');
      expect(recipients).toContain('author-1');
    });

    it('no deshace la resolución si falla un aviso', async () => {
      const { service, notifications } = build();
      notifications.enqueueDirectMessage.mockRejectedValue(new Error('sin red'));

      await expect(
        service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
          hideContent: true,
          sanction: false,
          note: null,
        }),
      ).resolves.toMatchObject({ resolved: true });
    });
  });

  describe('tomar un caso', () => {
    it('avisa cuando otra persona llegó primero', async () => {
      const { service } = build({ claim: jest.fn().mockResolvedValue(0) });

      // Dos moderadores decidiendo por separado sobre la misma foto es
      // exactamente lo que el bloqueo existe para impedir.
      await expect(
        service.claim(moderator, ModerationTargetKind.STORY, 'story-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

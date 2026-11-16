import { ConflictException, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ModerationService } from './moderation.service';
import { ModerationAutoHideService } from './moderation-auto-hide.service';
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
      canReporterSee: jest.fn().mockResolvedValue(true),
      canReporterViewComment: jest.fn().mockResolvedValue(true),
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
      findAccountRole: jest.fn().mockResolvedValue(UserRole.CLIENT),
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
    const minors = {
      suspendIfCorroborated: jest.fn().mockResolvedValue(true),
      confirm: jest.fn().mockResolvedValue(undefined),
      liftIfCleared: jest.fn().mockResolvedValue(undefined),
    };
    const evidence = {
      captureChatMessage: jest.fn().mockResolvedValue(undefined),
      findChatMessage: jest.fn().mockResolvedValue(null),
    };
    const safeguards = {
      openAutoHideReview: jest.fn().mockResolvedValue('review-1'),
      closeAutoHideReview: jest.fn().mockResolvedValue(false),
    };
    const chatEvents = { emitConversationRevoked: jest.fn() };
    const caseContent = {
      snapshot: jest.fn().mockResolvedValue({ content: null, contentUnavailableReason: 'ERASED', evidence: null }),
    };
    const noticeEmails = { enqueue: jest.fn().mockResolvedValue(true) };
    const autoHide = new ModerationAutoHideService(
      sequelize as never,
      repository as never,
      safeguards as never,
      notifications as never,
    );

    const service = new ModerationService(
      sequelize as never,
      repository as never,
      notifications as never,
      connections as never,
      passes as never,
      minors as never,
      evidence as never,
      autoHide,
      noticeEmails as never,
      caseContent as never,
      undefined,
      undefined,
      chatEvents as never,
    );
    return { service, repository, notifications, connections, passes, sequelize, minors, evidence, safeguards, chatEvents, noticeEmails, caseContent };
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

    it('un comentario visible se denuncia aunque su autor sea de otro gimnasio (ejercicio global)', async () => {
      const { service, repository } = build({
        findContentOwner: jest.fn().mockResolvedValue({ userId: 'author-1', tenantId: 'vecino' }),
      });
      const input = { ...reportInput, targetKind: ModerationTargetKind.COMMENT, targetId: 'comment-1' };

      await expect(service.report(reporter, input)).resolves.toMatchObject({ id: 'report-1' });
      expect(repository.canReporterViewComment).toHaveBeenCalledWith('comment-1', reporter.id);
      expect(repository.createReport).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'vecino', targetKind: ModerationTargetKind.COMMENT }),
        expect.anything(),
      );
    });

    it('un comentario que quien denuncia no puede leer responde 404', async () => {
      const { service, repository } = build({ canReporterViewComment: jest.fn().mockResolvedValue(false) });
      const input = { ...reportInput, targetKind: ModerationTargetKind.COMMENT, targetId: 'comment-1' };

      await expect(service.report(reporter, input)).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.createReport).not.toHaveBeenCalled();
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
        [{ viewerId: 'reporter-1', targetId: 'author-1', origin: 'REPORT' }],
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

  describe('salvaguardas al reportar', () => {
    it('una denuncia por menor de edad pide la suspensión corroborada en la misma transacción, sin escalera', async () => {
      const { service, minors, repository } = build();
      await service.report(reporter, { ...reportInput, targetKind: ModerationTargetKind.USER, targetId: 'author-1', reason: ModerationReason.MENOR_DE_EDAD });
      expect(minors.suspendIfCorroborated).toHaveBeenCalledWith(
        { reportedUserId: 'author-1', tenantId: expect.any(String), targetKind: ModerationTargetKind.USER }, expect.anything());
      expect(repository.createStrike).not.toHaveBeenCalled();
    });

    it('cualquier otro motivo no suspende a nadie', async () => {
      const { service, minors } = build();
      await service.report(reporter, reportInput);
      expect(minors.suspendIfCorroborated).not.toHaveBeenCalled();
    });

    it('guarda una copia de evidencia de un mensaje de chat denunciado', async () => {
      const { service, evidence } = build({ canReporterViewChatMessage: jest.fn().mockResolvedValue(true) });
      await service.report(reporter, { ...reportInput, targetKind: ModerationTargetKind.CHAT_MESSAGE, targetId: 'message-1' });
      expect(evidence.captureChatMessage).toHaveBeenCalledWith('message-1', expect.anything());
    });

    it('al ocultar por umbral abre un caso de revisión y avisa a la autora con el motivo', async () => {
      const { service, safeguards, notifications } = build({ countDistinctReporters: jest.fn().mockResolvedValue(3) });
      await service.report(reporter, reportInput);
      expect(safeguards.openAutoHideReview).toHaveBeenCalledWith(
        expect.objectContaining({ targetKind: 'STORY', targetId: 'story-1', authorUserId: 'author-1', distinctReporters: 3 }),
        expect.anything(),
      );
      const [notice] = notifications.enqueueDirectMessage.mock.calls[0] as [{ recipientUserId: string; body: string; metadata: { type: string } }];
      expect(notice).toMatchObject({ recipientUserId: 'author-1', metadata: { type: 'CONTENT_HIDDEN' } });
      expect(notice.body).toContain('Contenido sexual');
    });

    it('no revela a la persona denunciada quién la denunció al cerrar el chat', async () => {
      const { service, chatEvents, sequelize } = build();
      sequelize.query.mockImplementation((sql: string) => Promise.resolve(sql.includes('SELECT c.id') ? [{ id: 'conv-1' }] : []));
      await service.report(reporter, reportInput);
      expect(chatEvents.emitConversationRevoked).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('resolver', () => {
    it('cierra el caso sin sancionar cuando se descarta', async () => {
      const { service, repository } = build();

      const result = await service.resolve(
        moderator,
        ModerationTargetKind.STORY,
        'story-1',
        { hideContent: false, sanction: false, confirmMinor: false, note: null },
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
        confirmMinor: false,
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
        { hideContent: true, sanction: true, confirmMinor: false, note: 'desnudo' },
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
        { hideContent: true, sanction: true, confirmMinor: false, note: null },
      );

      expect(result.sanction).toMatchObject({ kind: StrikeKind.SUSPENSION, days: 7 });
      expect(repository.setSuspension).toHaveBeenCalledWith(
        'author-1',
        expect.any(Date),
        expect.anything(),
      );
    });

    it('confirmar un menor cierra la cuenta en vez de sancionar', async () => {
      const { service, repository, minors } = build();
      const result = await service.resolve(moderator, ModerationTargetKind.USER, 'author-1', {
        hideContent: false, sanction: true, confirmMinor: true, note: null,
      });
      expect(minors.confirm).toHaveBeenCalledWith('author-1', expect.anything());
      expect(repository.createStrike).not.toHaveBeenCalled();
      expect(repository.resolveTarget).toHaveBeenCalledWith(
        expect.objectContaining({ resolution: ModerationResolution.MENOR_CONFIRMADO, discarded: false }),
        expect.anything(),
      );
      expect(result).toMatchObject({ minorConfirmed: true, sanction: null });
    });

    it('descartar una denuncia por menor levanta la suspensión preventiva', async () => {
      const { service, minors } = build({
        findOpenReportsForTarget: jest.fn().mockResolvedValue([
          { id: 'report-1', reporterUserId: 'reporter-1', reportedUserId: 'author-1', tenantId: 'topfitness', reason: ModerationReason.MENOR_DE_EDAD },
        ]),
      });
      await service.resolve(moderator, ModerationTargetKind.USER, 'author-1', {
        hideContent: false, sanction: false, confirmMinor: false, note: null,
      });
      expect(minors.liftIfCleared).toHaveBeenCalledWith('author-1', { kind: 'USER', id: 'author-1' }, expect.anything(), {
        sanctionFollows: false,
      });
      expect(minors.confirm).not.toHaveBeenCalled();
    });

    it('el aviso de sanción dice el motivo (categoría y texto corto)', async () => {
      const { service, notifications } = build({ countActiveStrikes: jest.fn().mockResolvedValue(1) });
      await service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
        hideContent: true, sanction: true, confirmMinor: false, note: 'nota interna',
      });
      const sanctionNotice = (notifications.enqueueDirectMessage.mock.calls as [{ recipientUserId: string; body: string; metadata: Record<string, unknown> }][])
        .map(([message]) => message)
        .find((message) => message.recipientUserId === 'author-1' && message.metadata?.type === 'MODERATION_SANCTION');
      expect(sanctionNotice?.body).toContain('Motivo: Contenido sexual (contenido sexual o desnudos');
      expect(sanctionNotice?.body).not.toContain('nota interna');
      expect(sanctionNotice?.metadata).toMatchObject({ reason: 'CONTENIDO_SEXUAL', sanction: 'SUSPENSION', days: 1 });
    });

    it('una suspensión o una expulsión también se avisan por correo, una vez por falta; una advertencia no', async () => {
      const suspended = build({ countActiveStrikes: jest.fn().mockResolvedValue(1) });
      await suspended.service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
        hideContent: true, sanction: true, confirmMinor: false, note: 'nota interna',
      });
      expect(suspended.noticeEmails.enqueue).toHaveBeenCalledTimes(1);
      const [email] = suspended.noticeEmails.enqueue.mock.calls[0] as [{ recipientUserId: string; subject: string; body: string; deduplicationKey: string }];
      expect(email).toMatchObject({
        recipientUserId: 'author-1',
        subject: 'Tu cuenta ha sido suspendida',
        deduplicationKey: 'moderation.sanction:strike-1',
      });
      expect(email.body).toContain('Motivo: Contenido sexual');
      expect(email.body).not.toContain('nota interna');

      const expelled = build({ countActiveStrikes: jest.fn().mockResolvedValue(10) });
      const result = await expelled.service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
        hideContent: true, sanction: true, confirmMinor: false, note: null,
      });
      expect(result.sanction).toMatchObject({ kind: StrikeKind.EXPULSION });
      expect(expelled.noticeEmails.enqueue).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Tu cuenta ha sido cerrada' }), undefined);

      const warned = build({ countActiveStrikes: jest.fn().mockResolvedValue(0) });
      await warned.service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
        hideContent: true, sanction: true, confirmMinor: false, note: null,
      });
      expect(warned.noticeEmails.enqueue).not.toHaveBeenCalled();
    });

    it('el moderador restaura lo oculto por umbral, cierra la revisión y avisa a la autora', async () => {
      const { service, repository, safeguards, notifications } = build();
      safeguards.closeAutoHideReview.mockResolvedValue(true);
      await service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
        hideContent: false, sanction: false, confirmMinor: false, note: null,
      });
      expect(repository.setContentHidden).toHaveBeenCalledWith(expect.objectContaining({ hidden: false }), expect.anything());
      expect(safeguards.closeAutoHideReview).toHaveBeenCalledWith({ kind: 'STORY', id: 'story-1' }, 'mod-1', true, expect.anything());
      const types = (notifications.enqueueDirectMessage.mock.calls as [{ metadata?: { type?: string } }][]).map(([message]) => message.metadata?.type);
      expect(types).toContain('CONTENT_RESTORED');
    });

    it('rechaza un caso que ya no está abierto', async () => {
      const { service } = build({
        findOpenReportsForTarget: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.resolve(moderator, ModerationTargetKind.STORY, 'story-1', {
          hideContent: false,
          sanction: false,
          confirmMinor: false,
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
        confirmMinor: false,
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
          confirmMinor: false,
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

  describe('who may decide on a case (ADR-0018 §8)', () => {
    const platform = (id: string, role: UserRole): AuthenticatedUser => ({
      id, email: `${id}@repp.test`, role, tenantId: 'topfitness', tenantScope: role === UserRole.SYSTEM_ADMIN ? null : 'topfitness', impersonating: false,
    });
    const centralModerator = platform('mod-central', UserRole.MODERATOR);
    const systemAdmin = platform('sys-admin', UserRole.SYSTEM_ADMIN);
    const caseAbout = (reportedUserId: string, role: UserRole, reason: string = ModerationReason.ACOSO) => build({
      findOpenReportsForTarget: jest.fn().mockResolvedValue([
        { id: 'report-1', reporterUserId: 'reporter-1', reportedUserId, tenantId: 'topfitness', reason },
      ]),
      findReportsForTarget: jest.fn().mockResolvedValue([
        { id: 'report-1', reporterUserId: 'reporter-1', reportedUserId, tenantId: 'topfitness', reason, details: null, createdAt: new Date(), status: 'PENDIENTE' },
      ]),
      findAccountRole: jest.fn().mockResolvedValue(role),
      countActiveStrikes: jest.fn().mockResolvedValue(9),
    });
    const everything = { hideContent: true, sanction: true, confirmMinor: true, note: null };
    const expectRefusal = async (promise: Promise<unknown>, code: string) => {
      const error: unknown = await promise.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).getStatus()).toBe(403);
      expect((error as DomainException).code).toBe(code);
    };
    const expectNothingApplied = (built: ReturnType<typeof build>) => {
      expect(built.repository.createStrike).not.toHaveBeenCalled();
      expect(built.repository.setSuspension).not.toHaveBeenCalled();
      expect(built.repository.setContentHidden).not.toHaveBeenCalled();
      expect(built.repository.resolveTarget).not.toHaveBeenCalled();
      expect(built.minors.confirm).not.toHaveBeenCalled();
      expect(built.minors.liftIfCleared).not.toHaveBeenCalled();
      expect(built.sequelize.query).not.toHaveBeenCalled();
      expect(built.notifications.enqueueDirectMessage).not.toHaveBeenCalled();
      // The refused dossier never reads the reported content either.
      expect(built.caseContent.snapshot).not.toHaveBeenCalled();
    };

    it('nobody claims, reads or resolves a case about their own account', async () => {
      for (const actor of [centralModerator, systemAdmin]) {
        const built = caseAbout(actor.id, actor.role, ModerationReason.MENOR_DE_EDAD);
        await expectRefusal(built.service.claim(actor, ModerationTargetKind.USER, actor.id), 'MODERATION_SELF_CASE');
        await expectRefusal(built.service.getCase(actor, ModerationTargetKind.USER, actor.id), 'MODERATION_SELF_CASE');
        await expectRefusal(built.service.resolve(actor, ModerationTargetKind.USER, actor.id, everything), 'MODERATION_SELF_CASE');
        expect(built.repository.claim).not.toHaveBeenCalled();
        expectNothingApplied(built);
      }
    });

    it.each([UserRole.MODERATOR, UserRole.SYSTEM_ADMIN])(
      'a MODERATOR cannot claim, read or resolve a case about a %s account: no strike, expulsion, minor closure or hide',
      async (role) => {
        const built = caseAbout('peer-1', role, ModerationReason.MENOR_DE_EDAD);
        await expectRefusal(built.service.claim(centralModerator, ModerationTargetKind.STORY, 'story-1'), 'MODERATION_PEER_CASE');
        await expectRefusal(built.service.getCase(centralModerator, ModerationTargetKind.STORY, 'story-1'), 'MODERATION_PEER_CASE');
        await expectRefusal(built.service.resolve(centralModerator, ModerationTargetKind.STORY, 'story-1', everything), 'MODERATION_PEER_CASE');
        await expectRefusal(
          built.service.resolve(centralModerator, ModerationTargetKind.STORY, 'story-1', { ...everything, confirmMinor: false }),
          'MODERATION_PEER_CASE',
        );
        expect(built.repository.claim).not.toHaveBeenCalled();
        expectNothingApplied(built);
      },
    );

    it('a SYSTEM_ADMIN decides on a case about a moderator, with the role checked under the verdict lock', async () => {
      const built = caseAbout('peer-1', UserRole.MODERATOR);
      await built.service.claim(systemAdmin, ModerationTargetKind.USER, 'peer-1');
      const verdict = await built.service.resolve(systemAdmin, ModerationTargetKind.USER, 'peer-1', { ...everything, confirmMinor: false });
      expect(verdict.sanction).toMatchObject({ kind: StrikeKind.EXPULSION });
      expect(built.repository.findAccountRole).toHaveBeenLastCalledWith('peer-1', expect.anything());
    });

    it('the case file carries the read-only snapshot of the reported content for the moderator', async () => {
      const built = caseAbout('author-1', UserRole.CLIENT);
      const content = { kind: 'ROUTINE', name: 'Privada', description: null, visibility: 'PRIVATE', days: [], reach: { copies: 2, liveCopies: 1, activations: 3 } };
      built.caseContent.snapshot.mockResolvedValue({ content, contentUnavailableReason: null, evidence: null });
      const kase = await built.service.getCase(centralModerator, ModerationTargetKind.ROUTINE, 'routine-1');
      expect(built.caseContent.snapshot).toHaveBeenCalledWith(ModerationTargetKind.ROUTINE, 'routine-1');
      expect(kase).toMatchObject({ content, contentUnavailableReason: null, evidence: null });
    });

    it('a MODERATOR still decides on a member case', async () => {
      const built = caseAbout('author-1', UserRole.CLIENT);
      await expect(built.service.claim(centralModerator, ModerationTargetKind.USER, 'author-1')).resolves.toMatchObject({ claimed: true });
      await expect(built.service.resolve(centralModerator, ModerationTargetKind.USER, 'author-1', { ...everything, confirmMinor: false }))
        .resolves.toMatchObject({ resolved: true });
    });

    it('the queue never lists the viewer\'s own cases, and only a SYSTEM_ADMIN sees platform accounts', async () => {
      const built = build();
      await built.service.listQueue(centralModerator, 1, 20);
      expect(built.repository.findQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ viewerUserId: 'mod-central', includePlatformAccounts: false }),
      );
      await built.service.listQueue(systemAdmin, 1, 20);
      expect(built.repository.findQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ viewerUserId: 'sys-admin', includePlatformAccounts: true }),
      );
    });
  });
});

import { UserRole } from '../../common/enums/domain.enums';
import {
  AUTO_HIDE_DISTINCT_REPORTERS,
  caseRefusalFor,
  isBusinessTarget,
  isHideableTarget,
  ModerationReason,
  ModerationResolution,
  ModerationTargetKind,
  nextSanction,
  ReasonSeverity,
  severityOf,
  strikeExpiryFrom,
  StrikeKind,
} from './moderation.policy';
import { businessSuspensionReasonFor } from './moderation-business-resolution';

describe('Política de moderación', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const daysBetween = (from: Date, to: Date) =>
    Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));

  describe('la escalera de sanciones', () => {
    it('empieza por una advertencia, sin suspender', () => {
      const sanction = nextSanction(0, now);

      expect(sanction.kind).toBe(StrikeKind.ADVERTENCIA);
      expect(sanction.suspendedUntil).toBeNull();
      expect(sanction.resolution).toBe(ModerationResolution.USUARIO_ADVERTIDO);
    });

    it.each([
      [1, 1],
      [2, 3],
      [3, 7],
      [4, 30],
    ])(
      'con %i faltas previas suspende %i días',
      (previousStrikes, expectedDays) => {
        const sanction = nextSanction(previousStrikes, now);

        expect(sanction.kind).toBe(StrikeKind.SUSPENSION);
        expect(sanction.days).toBe(expectedDays);
        expect(daysBetween(now, sanction.suspendedUntil as Date)).toBe(expectedDays);
      },
    );

    it('expulsa a partir de la sexta falta, sin fecha de vuelta', () => {
      const sanction = nextSanction(5, now);

      expect(sanction.kind).toBe(StrikeKind.EXPULSION);
      // Ni fecha lejana ni suspensión larga: una expulsión que caduca sola en
      // 2099 es una mentira con fecha de caducidad.
      expect(sanction.suspendedUntil).toBeNull();
      expect(sanction.resolution).toBe(ModerationResolution.USUARIO_EXPULSADO);
    });

    it('no se pasa del último escalón por muchas faltas que haya', () => {
      expect(nextSanction(99, now).kind).toBe(StrikeKind.EXPULSION);
    });

    /**
     * El punto entero de que la escalera sea una función pura: dos moderadores
     * ante el mismo historial llegan a la misma sanción. Si esto deja de
     * cumplirse, el castigo vuelve a depender de quién miró el caso.
     */
    it('es determinista: mismo historial, misma sanción', () => {
      const first = nextSanction(3, now);
      const second = nextSanction(3, now);

      expect(first).toEqual(second);
    });

    it('trata un historial negativo como si estuviera limpio', () => {
      expect(nextSanction(-5, now).kind).toBe(StrikeKind.ADVERTENCIA);
    });
  });

  describe('caducidad del historial', () => {
    it('una falta deja de pesar al año', () => {
      expect(daysBetween(now, strikeExpiryFrom(now))).toBe(365);
    });
  });

  describe('urgencia de la cola', () => {
    it('pone por delante lo que no puede esperar', () => {
      expect(severityOf(ModerationReason.MENOR_DE_EDAD)).toBe(ReasonSeverity.CRITICA);
      expect(severityOf(ModerationReason.VIOLENCIA)).toBe(ReasonSeverity.CRITICA);
      expect(severityOf(ModerationReason.ACOSO)).toBe(ReasonSeverity.ALTA);
      expect(severityOf(ModerationReason.EJERCICIO_PELIGROSO)).toBe(ReasonSeverity.ALTA);
      expect(severityOf(ModerationReason.INFORMACION_ENGANOSA)).toBe(ReasonSeverity.NORMAL);
      expect(severityOf(ModerationReason.PLAGIO)).toBe(ReasonSeverity.NORMAL);
      expect(severityOf(ModerationReason.SPAM)).toBe(ReasonSeverity.NORMAL);
    });

    it('un menor pesa más que el spam', () => {
      expect(severityOf(ModerationReason.MENOR_DE_EDAD)).toBeGreaterThan(
        severityOf(ModerationReason.SPAM),
      );
    });
  });

  describe('qué se puede ocultar', () => {
    it('sólo el contenido con fila propia', () => {
      expect(isHideableTarget(ModerationTargetKind.STORY)).toBe(true);
      expect(isHideableTarget(ModerationTargetKind.PROFILE_PHOTO)).toBe(true);
      expect(isHideableTarget(ModerationTargetKind.ROUTINE)).toBe(true);
      expect(isHideableTarget(ModerationTargetKind.EXERCISE)).toBe(true);
      expect(isHideableTarget(ModerationTargetKind.COMMENT)).toBe(true);
      expect(isHideableTarget(ModerationTargetKind.REEL)).toBe(true);
    });

    it('a una persona se la sanciona, no se la oculta', () => {
      expect(isHideableTarget(ModerationTargetKind.USER)).toBe(false);
      // Los mensajes tampoco: ocultarlos obligaría a reescribir los acuses de
      // lectura de una conversación que las dos partes ya vieron.
      expect(isHideableTarget(ModerationTargetKind.CHAT_MESSAGE)).toBe(false);
    });
  });

  describe('umbral de auto-ocultado', () => {
    it('exige varias personas distintas, no varias quejas', () => {
      // Si bastara con una, alguien insistente tumbaría contenido ajeno solo.
      expect(AUTO_HIDE_DISTINCT_REPORTERS).toBeGreaterThan(1);
    });
  });

  describe('who may decide on a case (ADR-0018 §8)', () => {
    const moderator = { id: 'mod-1', role: UserRole.MODERATOR };
    const systemAdmin = { id: 'sys-1', role: UserRole.SYSTEM_ADMIN };

    it('refuses every case about the actor itself', () => {
      expect(caseRefusalFor(moderator, { id: 'mod-1', role: UserRole.MODERATOR })).toBe('MODERATION_SELF_CASE');
      expect(caseRefusalFor(systemAdmin, { id: 'sys-1', role: UserRole.SYSTEM_ADMIN })).toBe('MODERATION_SELF_CASE');
    });

    it('leaves cases about platform accounts to a SYSTEM_ADMIN', () => {
      expect(caseRefusalFor(moderator, { id: 'mod-2', role: UserRole.MODERATOR })).toBe('MODERATION_PEER_CASE');
      expect(caseRefusalFor(moderator, { id: 'sys-1', role: UserRole.SYSTEM_ADMIN })).toBe('MODERATION_PEER_CASE');
      expect(caseRefusalFor(systemAdmin, { id: 'mod-2', role: UserRole.MODERATOR })).toBeNull();
      expect(caseRefusalFor(systemAdmin, { id: 'sys-2', role: UserRole.SYSTEM_ADMIN })).toBeNull();
    });

    it('lets a moderator decide on members and erased accounts', () => {
      for (const role of [UserRole.CLIENT, null]) {
        expect(caseRefusalFor(moderator, { id: 'someone', role })).toBeNull();
      }
    });
  });
});

describe('marketplace cases (ADR-0022)', () => {
  it('a business registered with the moderator\'s own mailbox is the moderator\'s own case', () => {
    const moderator = { id: 'mod-1', role: UserRole.MODERATOR, email: 'Ana.Perez+repp@gmail.com' };
    expect(caseRefusalFor(moderator, { id: 'biz-1', role: UserRole.BUSINESS, email: 'anaperez+negocio@googlemail.com' })).toBe('MODERATION_SELF_CASE');
    expect(caseRefusalFor(moderator, { id: 'biz-2', role: UserRole.BUSINESS, email: 'otra@example.test' })).toBeNull();
    // A person is told apart by id only: two people may share a family mailbox alias.
    expect(caseRefusalFor(moderator, { id: 'person-1', role: UserRole.CLIENT, email: 'anaperez@gmail.com' })).toBeNull();
  });

  it('listings are hideable; a business profile is not (it is suspended), and both are marketplace targets', () => {
    expect(isHideableTarget(ModerationTargetKind.BUSINESS_LISTING)).toBe(true);
    expect(isHideableTarget(ModerationTargetKind.BUSINESS_PROFILE)).toBe(false);
    expect(isBusinessTarget(ModerationTargetKind.BUSINESS_PROFILE)).toBe(true);
    expect(isBusinessTarget(ModerationTargetKind.REEL)).toBe(false);
  });

  it('a disputed order is a marketplace target that is never hidden (ADR-0024)', () => {
    expect(isBusinessTarget(ModerationTargetKind.PAYMENT_ORDER)).toBe(true);
    expect(isHideableTarget(ModerationTargetKind.PAYMENT_ORDER)).toBe(false);
  });

  it('the business reads a suspension reason that fits the report', () => {
    expect(businessSuspensionReasonFor('PERFIL_FALSO')).toBe('IMPERSONATION');
    expect(businessSuspensionReasonFor('DROGAS')).toBe('PROHIBITED_ACTIVITY');
    expect(businessSuspensionReasonFor('SPAM')).toBe('OTHER');
  });
});

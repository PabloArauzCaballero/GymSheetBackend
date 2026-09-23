import {
  AUTO_HIDE_DISTINCT_REPORTERS,
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
});

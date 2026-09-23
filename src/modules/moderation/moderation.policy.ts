/**
 * Las reglas del motor de moderación, como funciones puras.
 *
 * Viven fuera del servicio a propósito: son las decisiones que hay que poder
 * leer, discutir y probar sin levantar una base de datos. Un equipo de
 * moderación discute la escalera, no el SQL.
 */

/** Qué se puede reportar. */
export const ModerationTargetKind = {
  STORY: 'STORY',
  PROFILE_PHOTO: 'PROFILE_PHOTO',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  USER: 'USER',
} as const;
export type ModerationTargetKindValue =
  (typeof ModerationTargetKind)[keyof typeof ModerationTargetKind];

/** Por qué. Taxonomía cerrada: un campo libre no se puede priorizar ni contar. */
export const ModerationReason = {
  CONTENIDO_SEXUAL: 'CONTENIDO_SEXUAL',
  ACOSO: 'ACOSO',
  DISCURSO_DE_ODIO: 'DISCURSO_DE_ODIO',
  VIOLENCIA: 'VIOLENCIA',
  SPAM: 'SPAM',
  PERFIL_FALSO: 'PERFIL_FALSO',
  MENOR_DE_EDAD: 'MENOR_DE_EDAD',
  DROGAS: 'DROGAS',
  OTRO: 'OTRO',
} as const;
export type ModerationReasonValue =
  (typeof ModerationReason)[keyof typeof ModerationReason];

export const ModerationStatus = {
  PENDIENTE: 'PENDIENTE',
  EN_REVISION: 'EN_REVISION',
  RESUELTO: 'RESUELTO',
  DESCARTADO: 'DESCARTADO',
} as const;
export type ModerationStatusValue =
  (typeof ModerationStatus)[keyof typeof ModerationStatus];

export const ModerationResolution = {
  SIN_ACCION: 'SIN_ACCION',
  CONTENIDO_OCULTO: 'CONTENIDO_OCULTO',
  USUARIO_ADVERTIDO: 'USUARIO_ADVERTIDO',
  USUARIO_SUSPENDIDO: 'USUARIO_SUSPENDIDO',
  USUARIO_EXPULSADO: 'USUARIO_EXPULSADO',
} as const;
export type ModerationResolutionValue =
  (typeof ModerationResolution)[keyof typeof ModerationResolution];

export const StrikeKind = {
  ADVERTENCIA: 'ADVERTENCIA',
  SUSPENSION: 'SUSPENSION',
  EXPULSION: 'EXPULSION',
} as const;
export type StrikeKindValue = (typeof StrikeKind)[keyof typeof StrikeKind];

/**
 * Urgencia de un motivo, que es lo que ordena la cola.
 *
 * Una cola estrictamente cronológica trata igual «me mandó publicidad» que «hay
 * un menor en esta foto», y la segunda no puede esperar detrás de cuarenta de
 * las primeras. Son tres niveles y no diez: un moderador distingue «ya» de
 * «hoy» de «cuando toque», y pedirle más granularidad sólo produce discusiones
 * sobre si algo era un 6 o un 7.
 */
export const ReasonSeverity = {
  CRITICA: 3,
  ALTA: 2,
  NORMAL: 1,
} as const;

const SEVERITY_BY_REASON: Record<ModerationReasonValue, number> = {
  // Riesgo para una persona real, y para nosotros si tardamos.
  [ModerationReason.MENOR_DE_EDAD]: ReasonSeverity.CRITICA,
  [ModerationReason.VIOLENCIA]: ReasonSeverity.CRITICA,
  // Daño a alguien concreto que ya está ocurriendo.
  [ModerationReason.ACOSO]: ReasonSeverity.ALTA,
  [ModerationReason.DISCURSO_DE_ODIO]: ReasonSeverity.ALTA,
  [ModerationReason.CONTENIDO_SEXUAL]: ReasonSeverity.ALTA,
  // Molesto o tramposo, pero nadie sale herido esta tarde.
  [ModerationReason.PERFIL_FALSO]: ReasonSeverity.NORMAL,
  [ModerationReason.DROGAS]: ReasonSeverity.NORMAL,
  [ModerationReason.SPAM]: ReasonSeverity.NORMAL,
  [ModerationReason.OTRO]: ReasonSeverity.NORMAL,
};

export function severityOf(reason: ModerationReasonValue): number {
  return SEVERITY_BY_REASON[reason] ?? ReasonSeverity.NORMAL;
}

/**
 * Cuántos denunciantes DISTINTOS ocultan un contenido sin esperar a un humano.
 *
 * Distintos, no reportes: si contara reportes, una sola persona insistente
 * bastaría para tumbar el contenido de otra. Tres es un compromiso — lo bastante
 * bajo para que actúe de verdad en un gimnasio de unos cientos de socios, y lo
 * bastante alto para que no lo dispare un par de amigos poniéndose de acuerdo.
 *
 * El ocultado es REVERSIBLE y no sanciona a nadie: es una cortina hasta que
 * alguien mire, no un veredicto.
 */
export const AUTO_HIDE_DISTINCT_REPORTERS = 3;

/** Cuánto pesa una sanción antes de caducar: un año, como en Facebook. */
export const STRIKE_LIFETIME_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * La escalera.
 *
 * `previousActiveStrikes` son las sanciones NO caducadas que la persona ya
 * tenía antes de ésta. El índice es ese número, así que la primera falta cae en
 * la posición 0.
 *
 * `null` significa expulsión: no hay fecha de vuelta.
 */
const SUSPENSION_LADDER_DAYS: readonly (number | null)[] = [
  0, // 1.ª: advertencia, sin suspensión
  1, // 2.ª: un día
  3, // 3.ª
  7, // 4.ª
  30, // 5.ª
  null, // 6.ª y siguientes: expulsión
];

export type Sanction = {
  kind: StrikeKindValue;
  /** Hasta cuándo no puede entrar. `null` en advertencia y en expulsión. */
  suspendedUntil: Date | null;
  /** Días de suspensión, para poder anunciarlo antes de aplicarlo. */
  days: number | null;
  resolution: ModerationResolutionValue;
};

/**
 * Qué le toca a esta persona por su siguiente falta.
 *
 * Es una función pura y determinista, y ése es el punto entero: la duración no
 * la decide quién revisa el caso ni la hora a la que lo revisa. Dos moderadores
 * distintos ante el mismo historial llegan a la misma sanción, que es lo que
 * permite defenderla cuando el sancionado pregunta por qué.
 *
 * `now` entra como parámetro para que la prueba no dependa del reloj.
 */
export function nextSanction(
  previousActiveStrikes: number,
  now: Date = new Date(),
): Sanction {
  const index = Math.min(
    Math.max(previousActiveStrikes, 0),
    SUSPENSION_LADDER_DAYS.length - 1,
  );
  const days = SUSPENSION_LADDER_DAYS[index] ?? null;

  if (days === null) {
    return {
      kind: StrikeKind.EXPULSION,
      suspendedUntil: null,
      days: null,
      resolution: ModerationResolution.USUARIO_EXPULSADO,
    };
  }

  if (days === 0) {
    return {
      kind: StrikeKind.ADVERTENCIA,
      suspendedUntil: null,
      days: 0,
      resolution: ModerationResolution.USUARIO_ADVERTIDO,
    };
  }

  return {
    kind: StrikeKind.SUSPENSION,
    suspendedUntil: new Date(now.getTime() + days * DAY_MS),
    days,
    resolution: ModerationResolution.USUARIO_SUSPENDIDO,
  };
}

/** Cuándo deja de contar una sanción emitida ahora. */
export function strikeExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + STRIKE_LIFETIME_DAYS * DAY_MS);
}

/** Sólo el contenido con fila propia se puede ocultar; a una persona se la sanciona. */
export function isHideableTarget(kind: ModerationTargetKindValue): boolean {
  return (
    kind === ModerationTargetKind.STORY || kind === ModerationTargetKind.PROFILE_PHOTO
  );
}

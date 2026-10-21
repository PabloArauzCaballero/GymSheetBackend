/**
 * Strikes y penalizaciones de racha: quién falta a su plan y qué le cuesta.
 *
 * ─── Las reglas (Pablo, 2026-10-19 y 2026-10-21) ───────────────────────────
 *
 * - La racha se mantiene mientras se cumple **el propio plan**: los días de la
 *   semana que no son de descanso declarado. Sin plan declarado no hay
 *   penalizaciones: no se le puede exigir a nadie un plan que no tiene.
 * - **Reponer**: entrenar en un día de descanso de la **misma semana** cubre
 *   una falta de esa semana. Mientras la semana no ha terminado, una falta está
 *   pendiente de reponer: ni gasta strike ni penaliza todavía.
 * - Una falta no repuesta gasta **un strike del mes** de la falta: tres de base
 *   más los comprados con puntos ese mes.
 * - Sin strikes, la falta **penaliza** (50 puntos) y no protege la racha.
 *
 * Dos salvaguardas, para que la regla castigue el descuido y no el abandono:
 * solo se penaliza en semanas en las que se entrenó al menos una vez (quien
 * deja de venir pierde la racha, no los puntos de años), y solo cuentan las
 * faltas desde `STRIKES_EFFECTIVE_FROM`, el día en que la regla entró en
 * vigor: nada retroactivo.
 *
 * ─── Por qué es una función pura ────────────────────────────────────────────
 *
 * Como la racha (`computeStreaks`), todo sale del historial: recalcular dos
 * veces da lo mismo, y corregir una sesión mal registrada recoloca strikes y
 * penalizaciones solos. Lo único guardado son los strikes **comprados**, que
 * no se pueden deducir de nada.
 */

/** Primer día en que una falta puede gastar strike o penalizar. */
export const STRIKES_EFFECTIVE_FROM = "2026-10-22";

const DAYS_PER_WEEK = 7;

export interface StrikeSettlement {
  /** Faltas cubiertas por strike, por mes (`YYYY-MM`). */
  readonly usedByMonth: Readonly<Record<string, number>>;
  /** Faltas penalizadas, por mes. */
  readonly penalizedByMonth: Readonly<Record<string, number>>;
  /** Faltas que ya no rompen la racha: repuestas, cubiertas por strike o aún reponibles. */
  readonly forgivenDays: ReadonlySet<string>;
  /** Faltas de esta semana que todavía se pueden reponer. */
  readonly pendingThisWeek: number;
}

export interface StrikeInput {
  /** Días con entrenamiento (`YYYY-MM-DD`), ordenados y sin repetir. */
  readonly trainingDays: readonly string[];
  /** Hoy en la zona del gimnasio (`YYYY-MM-DD`). Hoy no cuenta como falta. */
  readonly today: string;
  /** Días de descanso declarados (ISO: 1 lunes … 7 domingo). */
  readonly restWeekdays: ReadonlySet<number>;
  /** Si el socio declaró su plan semanal. Sin plan, no hay faltas. */
  readonly planDeclared: boolean;
  /** Strikes comprados por mes. */
  readonly purchasedByMonth: Readonly<Record<string, number>>;
  readonly monthlyStrikes: number;
  readonly effectiveFrom?: string;
}

const EMPTY: StrikeSettlement = {
  usedByMonth: {},
  penalizedByMonth: {},
  forgivenDays: new Set(),
  pendingThisWeek: 0,
};

export function settleStrikes(input: StrikeInput): StrikeSettlement {
  const { trainingDays, today, restWeekdays, planDeclared } = input;
  if (!planDeclared || trainingDays.length === 0) return EMPTY;
  // Si se declaran los siete días de descanso no hay días de plan que faltar.
  if (restWeekdays.size >= DAYS_PER_WEEK) return EMPTY;

  const effectiveFrom = input.effectiveFrom ?? STRIKES_EFFECTIVE_FROM;
  const trained = new Set(trainingDays);
  const currentWeek = weekStart(today);

  // Reposiciones disponibles por semana: entrenos en días de descanso.
  const makeups = new Map<string, number>();
  const activeWeeks = new Set<string>();
  for (const day of trainingDays) {
    const week = weekStart(day);
    activeWeeks.add(week);
    if (restWeekdays.has(isoWeekday(day))) makeups.set(week, (makeups.get(week) ?? 0) + 1);
  }

  const used: Record<string, number> = {};
  const penalized: Record<string, number> = {};
  const forgiven = new Set<string>();
  let pendingThisWeek = 0;

  const start = trainingDays[0] > effectiveFrom ? trainingDays[0] : effectiveFrom;
  for (let day = start; day < today; day = shiftDays(day, 1)) {
    if (trained.has(day) || restWeekdays.has(isoWeekday(day))) continue;

    const week = weekStart(day);
    const available = makeups.get(week) ?? 0;
    if (available > 0) {
      makeups.set(week, available - 1);
      forgiven.add(day);
      continue;
    }
    if (week === currentWeek) {
      // La semana sigue abierta: todavía se puede reponer.
      forgiven.add(day);
      pendingThisWeek += 1;
      continue;
    }

    const month = day.slice(0, 7);
    const allowance = input.monthlyStrikes + (input.purchasedByMonth[month] ?? 0);
    if ((used[month] ?? 0) < allowance) {
      used[month] = (used[month] ?? 0) + 1;
      forgiven.add(day);
      continue;
    }
    if (activeWeeks.has(week)) penalized[month] = (penalized[month] ?? 0) + 1;
  }

  return { usedByMonth: used, penalizedByMonth: penalized, forgivenDays: forgiven, pendingThisWeek };
}

/** Suma de los valores de un registro por mes. */
export function totalOf(byMonth: Readonly<Record<string, number>>): number {
  return Object.values(byMonth).reduce((total, value) => total + value, 0);
}

// ───────────────────────────────────────────────────────────── fechas (UTC)

function toUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function shiftDays(day: string, offset: number): string {
  const date = toUtcDate(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** 1 = lunes … 7 = domingo. */
function isoWeekday(day: string): number {
  const jsDay = toUtcDate(day).getUTCDay();
  return jsDay === 0 ? DAYS_PER_WEEK : jsDay;
}

/** Lunes de la semana ISO del día. */
function weekStart(day: string): string {
  return shiftDays(day, 1 - isoWeekday(day));
}

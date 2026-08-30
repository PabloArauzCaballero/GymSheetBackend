import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
import { ProgressionBadgeModel } from "./progression-badge.model";
import { ProgressionLevelModel } from "./progression-level.model";
import { RestDayPreferenceModel } from "./rest-day-preference.model";
import { UserBadgeModel } from "./user-badge.model";
import { UserProgressModel } from "./user-progress.model";
import type { ProgressionAudience } from "./progression-catalog";

/**
 * Métricas de entrenamiento de un usuario.
 *
 * Cada campo corresponde a un `criterion_type` de las insignias. Se calculan
 * todas de una vez, en una sola consulta: pedirlas por separado significaría
 * recorrer las mismas series una vez por insignia, y el catálogo crece.
 */
export interface TrainingMetrics {
  readonly totalSessions: number;
  readonly totalSets: number;
  readonly totalReps: number;
  readonly totalVolumeKg: number;
  readonly maxSessionVolumeKg: number;
  readonly distinctExercises: number;
  readonly distinctMuscleGroups: number;
  readonly earlySessions: number;
  readonly nightSessions: number;
  readonly weekendSessions: number;
  readonly personalRecords: number;
  readonly currentStreakDays: number;
  readonly longestStreakDays: number;
  readonly weeklyStreak: number;
  readonly lastSessionOn: string | null;
  readonly firstSessionOn: string | null;
}

interface AggregateRow {
  total_sessions: string;
  total_sets: string;
  total_reps: string;
  total_volume_kg: string | null;
  max_session_volume_kg: string | null;
  distinct_exercises: string;
  distinct_muscle_groups: string;
  early_sessions: string;
  night_sessions: string;
  weekend_sessions: string;
  personal_records: string;
}

interface SessionDayRow {
  day: string;
}

const EMPTY_METRICS: TrainingMetrics = {
  totalSessions: 0,
  totalSets: 0,
  totalReps: 0,
  totalVolumeKg: 0,
  maxSessionVolumeKg: 0,
  distinctExercises: 0,
  distinctMuscleGroups: 0,
  earlySessions: 0,
  nightSessions: 0,
  weekendSessions: 0,
  personalRecords: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  weeklyStreak: 0,
  lastSessionOn: null,
  firstSessionOn: null,
};

/**
 * Solo cuentan las sesiones finalizadas.
 *
 * Una sesión abierta o cancelada no es esfuerzo consumado, y admitirla dejaría
 * la puerta abierta a subir de rango abriendo sesiones vacías, que es la forma
 * más rápida de que el sistema deje de significar nada.
 */
const FINISHED = "FINALIZADA";

@Injectable()
export class ProgressionRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ProgressionLevelModel)
    private readonly levelModel: typeof ProgressionLevelModel,
    @InjectModel(ProgressionBadgeModel)
    private readonly badgeModel: typeof ProgressionBadgeModel,
    @InjectModel(UserBadgeModel)
    private readonly userBadgeModel: typeof UserBadgeModel,
    @InjectModel(UserProgressModel)
    private readonly userProgressModel: typeof UserProgressModel,
    @InjectModel(RestDayPreferenceModel)
    private readonly restDayPreferenceModel: typeof RestDayPreferenceModel,
  ) {}

  // ────────────────────────────────────────────────────────── días de descanso

  async getRestWeekdays(userId: string): Promise<ReadonlySet<number>> {
    const row = await this.restDayPreferenceModel.findByPk(userId);
    return new Set(row?.weekdays ?? []);
  }

  async setRestWeekdays(userId: string, weekdays: readonly number[]): Promise<void> {
    await this.restDayPreferenceModel.upsert({
      userId,
      weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
    });
  }

  // ───────────────────────────────────────────────────────────────── catálogo

  /**
   * El camino de un usuario: **una sola** rama, la suya.
   *
   * A diferencia de las insignias, los rangos no se mezclan entre audiencias.
   * Cada rama es un relato completo de ocho hitos con sus propios nombres, y
   * unir dos ramas no da un camino más rico: da una lista con trece paradas y
   * dos historias entrelazadas, que es exactamente lo que no debe verse.
   *
   * Se cae a la rama neutra solo si la propia está vacía —un gimnasio que
   * desactivó sus rangos con género—, porque quedarse sin camino sería peor que
   * ver el genérico.
   *
   * Dentro de la rama elegida, un rango del gimnasio con el mismo `code` que uno
   * global lo sustituye: así una marca reescribe un hito suelto sin tener que
   * redefinir los ocho.
   */
  async listLevels(
    tenantId: string | null,
    audience: ProgressionAudience,
  ): Promise<ProgressionLevelModel[]> {
    const own = await this.findLevelsForAudience(tenantId, audience);
    if (own.length > 0 || audience === "ANY") return own;
    return this.findLevelsForAudience(tenantId, "ANY");
  }

  private async findLevelsForAudience(
    tenantId: string | null,
    audience: ProgressionAudience,
  ): Promise<ProgressionLevelModel[]> {
    const rows = await this.levelModel.findAll({
      where: {
        active: true,
        audience,
        tenantId: { [Op.or]: [null, tenantId ?? ""] },
      },
      order: [["sortOrder", "ASC"]],
    });
    return resolveOverrides(rows, tenantId, audience).sort(
      (left, right) => left.minPoints - right.minPoints,
    );
  }

  async listBadges(
    tenantId: string | null,
    audience: ProgressionAudience,
  ): Promise<ProgressionBadgeModel[]> {
    const rows = await this.badgeModel.findAll({
      where: {
        active: true,
        audience: { [Op.in]: audienceChain(audience) },
        tenantId: { [Op.or]: [null, tenantId ?? ""] },
      },
      order: [["sortOrder", "ASC"]],
    });
    return resolveOverrides(rows, tenantId, audience).sort(
      (left, right) => left.sortOrder - right.sortOrder,
    );
  }

  // ─────────────────────────────────────────────────────────── administración

  listAllLevels(): Promise<ProgressionLevelModel[]> {
    return this.levelModel.findAll({
      order: [
        ["audience", "ASC"],
        ["sortOrder", "ASC"],
      ],
    });
  }

  listAllBadges(): Promise<ProgressionBadgeModel[]> {
    return this.badgeModel.findAll({
      order: [
        ["audience", "ASC"],
        ["sortOrder", "ASC"],
      ],
    });
  }

  findLevelById(id: string): Promise<ProgressionLevelModel | null> {
    return this.levelModel.findByPk(id);
  }

  findBadgeById(id: string): Promise<ProgressionBadgeModel | null> {
    return this.badgeModel.findByPk(id);
  }

  createLevel(
    values: Partial<ProgressionLevelModel>,
  ): Promise<ProgressionLevelModel> {
    return this.levelModel.create(values as never);
  }

  createBadge(
    values: Partial<ProgressionBadgeModel>,
  ): Promise<ProgressionBadgeModel> {
    return this.badgeModel.create(values as never);
  }

  // ───────────────────────────────────────────────────────────── conseguidas

  listUserBadges(userId: string): Promise<UserBadgeModel[]> {
    return this.userBadgeModel.findAll({
      where: { userId },
      order: [["awardedAt", "DESC"]],
    });
  }

  /**
   * Registra las insignias recién conseguidas.
   *
   * `ignoreDuplicates` en vez de comprobar antes: dos peticiones simultáneas
   * del mismo usuario —abrir la pantalla desde el móvil y la web a la vez— se
   * cruzarían entre la lectura y la escritura, y la clave primaria compuesta ya
   * decide quién gana sin que nadie reciba un error por ello.
   */
  async awardBadges(
    userId: string,
    awards: readonly { badgeId: string; progressValue: number }[],
    transaction?: Transaction,
  ): Promise<void> {
    if (awards.length === 0) return;
    await this.userBadgeModel.bulkCreate(
      awards.map((award) => ({
        userId,
        badgeId: award.badgeId,
        progressValue: award.progressValue.toFixed(2),
      })) as never,
      { ignoreDuplicates: true, transaction },
    );
  }

  async markBadgesSeen(userId: string): Promise<void> {
    await this.userBadgeModel.update(
      { seen: true },
      { where: { userId, seen: false } },
    );
  }

  findProgress(userId: string): Promise<UserProgressModel | null> {
    return this.userProgressModel.findByPk(userId);
  }

  async saveProgress(
    userId: string,
    values: {
      points: number;
      levelCode: string | null;
      currentStreakDays: number;
      longestStreakDays: number;
      lastSessionOn: string | null;
      totalSessions: number;
      totalSets: number;
      totalVolumeKg: number;
    },
  ): Promise<void> {
    await this.userProgressModel.upsert({
      userId,
      points: values.points,
      levelCode: values.levelCode,
      currentStreakDays: values.currentStreakDays,
      longestStreakDays: values.longestStreakDays,
      lastSessionOn: values.lastSessionOn,
      totalSessions: values.totalSessions,
      totalSets: values.totalSets,
      totalVolumeKg: values.totalVolumeKg.toFixed(2),
      recomputedAt: new Date(),
    } as never);
  }

  // ─────────────────────────────────────────────────────────────── métricas

  /**
   * Recalcula todas las métricas de entrenamiento desde cero.
   *
   * Los días y las horas se convierten a la zona horaria del negocio antes de
   * agruparse: una sesión de las 23:30 pertenece a ese día para quien la
   * entrenó, y en UTC caería en el siguiente y partiría su racha en dos.
   */
  async computeMetrics(userId: string): Promise<TrainingMetrics> {
    const timeZone = env.BUSINESS_TIME_ZONE;

    const [aggregate] = await this.sequelize.query<AggregateRow>(
      `
      WITH sesion AS (
        SELECT s.id,
               s.fecha_inicio AT TIME ZONE :timeZone AS local_start
          FROM public.sesiones_entrenamiento s
         WHERE s.usuario_id = :userId AND s.estado = :finished
      ),
      serie AS (
        SELECT se.sesion_id,
               se.ejercicio_id,
               st.repeticiones,
               st.peso_kg,
               st.peso_kg * st.repeticiones AS volumen,
               st.fecha_registro
          FROM public.sesiones_ejercicios se
          JOIN sesion ON sesion.id = se.sesion_id
          JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id
      ),
      por_sesion AS (
        SELECT sesion_id, SUM(volumen) AS volumen FROM serie GROUP BY sesion_id
      ),
      -- Un récord personal es una serie que supera a todo lo levantado antes en
      -- ese mismo ejercicio. La primera serie de un ejercicio no lo es: no hay
      -- marca previa que batir, y contarla convertiría «probar algo nuevo» en
      -- «batir un récord».
      records AS (
        SELECT DISTINCT ejercicio_id
          FROM (
            SELECT ejercicio_id,
                   peso_kg,
                   MAX(peso_kg) OVER (
                     PARTITION BY ejercicio_id
                     ORDER BY fecha_registro
                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                   ) AS mejor_previo
              FROM serie
          ) historial
         WHERE mejor_previo IS NOT NULL AND peso_kg > mejor_previo
      )
      SELECT
        (SELECT COUNT(*) FROM sesion)::text AS total_sessions,
        (SELECT COUNT(*) FROM serie)::text AS total_sets,
        (SELECT COALESCE(SUM(repeticiones), 0) FROM serie)::text AS total_reps,
        (SELECT COALESCE(SUM(volumen), 0) FROM serie)::text AS total_volume_kg,
        (SELECT COALESCE(MAX(volumen), 0) FROM por_sesion)::text AS max_session_volume_kg,
        (SELECT COUNT(DISTINCT ejercicio_id) FROM serie)::text AS distinct_exercises,
        (SELECT COUNT(DISTINCT mg.code)
           FROM serie
           JOIN training.exercise_muscles em ON em.ejercicio_id = serie.ejercicio_id
           JOIN training.muscles m ON m.id = em.muscle_id
           JOIN training.muscle_groups mg ON mg.id = m.muscle_group_id
          WHERE em.role = 'PRIMARY')::text AS distinct_muscle_groups,
        (SELECT COUNT(*) FROM sesion WHERE EXTRACT(HOUR FROM local_start) < 7)::text AS early_sessions,
        (SELECT COUNT(*) FROM sesion WHERE EXTRACT(HOUR FROM local_start) >= 21)::text AS night_sessions,
        (SELECT COUNT(*) FROM sesion WHERE EXTRACT(ISODOW FROM local_start) >= 6)::text AS weekend_sessions,
        (SELECT COUNT(*) FROM records)::text AS personal_records
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, timeZone, finished: FINISHED },
      },
    );

    if (!aggregate || Number(aggregate.total_sessions) === 0) {
      return EMPTY_METRICS;
    }

    const days = await this.sequelize.query<SessionDayRow>(
      `SELECT DISTINCT to_char(
                (s.fecha_inicio AT TIME ZONE :timeZone)::date, 'YYYY-MM-DD'
              ) AS day
         FROM public.sesiones_entrenamiento s
        WHERE s.usuario_id = :userId AND s.estado = :finished
        ORDER BY day ASC`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, timeZone, finished: FINISHED },
      },
    );

    const trainingDays = days.map((row) => row.day);
    const restWeekdays = await this.getRestWeekdays(userId);
    const streaks = computeStreaks(trainingDays, businessToday(timeZone), restWeekdays);

    return {
      totalSessions: Number(aggregate.total_sessions),
      totalSets: Number(aggregate.total_sets),
      totalReps: Number(aggregate.total_reps),
      totalVolumeKg: Number(aggregate.total_volume_kg ?? 0),
      maxSessionVolumeKg: Number(aggregate.max_session_volume_kg ?? 0),
      distinctExercises: Number(aggregate.distinct_exercises),
      distinctMuscleGroups: Number(aggregate.distinct_muscle_groups),
      earlySessions: Number(aggregate.early_sessions),
      nightSessions: Number(aggregate.night_sessions),
      weekendSessions: Number(aggregate.weekend_sessions),
      personalRecords: Number(aggregate.personal_records),
      currentStreakDays: streaks.current,
      longestStreakDays: streaks.longest,
      weeklyStreak: streaks.weeks,
      lastSessionOn: trainingDays.at(-1) ?? null,
      firstSessionOn: trainingDays[0] ?? null,
    };
  }

  /**
   * Clasificación del gimnasio, para la pantalla de la senda.
   *
   * El orden por racha desempata por puntos: dos personas con la misma racha
   * vigente no deberían parecer iguales si una lleva mucho más entrenado.
   */
  leaderboard(
    tenantId: string | null,
    limit: number,
    sortBy: "points" | "streak" = "points",
  ): Promise<
    Array<{
      userId: string;
      fullName: string;
      points: number;
      levelCode: string | null;
      currentStreakDays: number;
    }>
  > {
    const orderBy =
      sortBy === "streak"
        ? "p.current_streak_days DESC, p.points DESC"
        : "p.points DESC, p.current_streak_days DESC";
    return this.sequelize.query(
      `SELECT p.usuario_id AS "userId",
              u.nombre_completo AS "fullName",
              p.points,
              p.level_code AS "levelCode",
              p.current_streak_days AS "currentStreakDays"
         FROM progression.user_progress p
         JOIN public.usuarios u ON u.id = p.usuario_id
        WHERE u.estado = 'ACTIVO'
          AND (:tenantId::text IS NULL OR u.tenant_id IS NOT DISTINCT FROM :tenantId)
          AND p.points > 0
        ORDER BY ${orderBy}
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { tenantId, limit } },
    );
  }
}

/**
 * Ramas del catálogo aplicables a una audiencia.
 *
 * Una persona que declara género ve su rama **y** la neutra, porque casi todas
 * las insignias son neutras y limitarlo a la rama propia dejaría el catálogo
 * casi vacío. Quien no declara nada ve solo la neutra: mostrarle las dos ramas
 * con género sería devolverle la pregunta que decidió no contestar.
 */
function audienceChain(audience: ProgressionAudience): ProgressionAudience[] {
  return audience === "ANY" ? ["ANY"] : ["ANY", audience];
}

/**
 * Deja una fila por `code`, prefiriendo la del gimnasio sobre la global y la de
 * la rama con género sobre la neutra.
 */
function resolveOverrides<
  T extends { code: string; tenantId: string | null; audience: ProgressionAudience },
>(rows: T[], tenantId: string | null, audience: ProgressionAudience): T[] {
  const byCode = new Map<string, T>();
  for (const row of rows) {
    const current = byCode.get(row.code);
    if (!current || specificity(row, tenantId, audience) > specificity(current, tenantId, audience)) {
      byCode.set(row.code, row);
    }
  }
  return [...byCode.values()];
}

function specificity(
  row: { tenantId: string | null; audience: ProgressionAudience },
  tenantId: string | null,
  audience: ProgressionAudience,
): number {
  return (
    (row.tenantId !== null && row.tenantId === tenantId ? 2 : 0) +
    (row.audience === audience && audience !== "ANY" ? 1 : 0)
  );
}

function businessToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Rachas a partir de los días con entrenamiento, ya ordenados y sin repetir.
 *
 * La racha actual admite que hoy todavía no se haya entrenado: si el último día
 * fue ayer sigue viva. Cortarla a medianoche castigaría a quien entrena por la
 * tarde cada vez que abre la aplicación por la mañana.
 *
 * `restWeekdays` son los días de la semana (ISO: 1 lunes ... 7 domingo) que el
 * usuario declaró como descanso planificado: un hueco entre dos entrenamientos
 * no rompe la racha si todos los días saltados caen en esos días. Vacío por
 * defecto, que reproduce exactamente la tolerancia genérica anterior (un hueco
 * de un día siempre puentea; de dos o más, nunca).
 */
export function computeStreaks(
  trainingDays: readonly string[],
  today: string,
  restWeekdays: ReadonlySet<number> = new Set(),
): { current: number; longest: number; weeks: number } {
  if (trainingDays.length === 0) return { current: 0, longest: 0, weeks: 0 };

  let longest = 1;
  let run = 1;
  for (let index = 1; index < trainingDays.length; index += 1) {
    const bridged = bridgedByRestDays(trainingDays[index - 1], trainingDays[index], restWeekdays);
    run = bridged ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const last = trainingDays.at(-1)!;
  let current = 0;
  if (bridgedByRestDays(last, today, restWeekdays)) {
    current = 1;
    for (let index = trainingDays.length - 1; index > 0; index -= 1) {
      if (!bridgedByRestDays(trainingDays[index - 1], trainingDays[index], restWeekdays)) break;
      current += 1;
    }
  }

  return { current, longest, weeks: consecutiveWeeks(trainingDays, today) };
}

/**
 * Si el hueco entre dos días es de uno o cero, siempre son consecutivos — es
 * la tolerancia base que ya existía. Si es mayor, solo lo son cuando cada día
 * saltado en el medio es un día de descanso declarado.
 */
function bridgedByRestDays(
  fromDay: string,
  toDay: string,
  restWeekdays: ReadonlySet<number>,
): boolean {
  const gap = dayDistance(fromDay, toDay);
  if (gap <= 1) return true;
  for (let offset = 1; offset < gap; offset += 1) {
    if (!restWeekdays.has(isoWeekday(shiftDays(fromDay, offset)))) return false;
  }
  return true;
}

/** 1 = lunes ... 7 = domingo, igual que `EXTRACT(ISODOW ...)` en SQL. */
function isoWeekday(dateOnly: string): number {
  const jsDay = toUtcDate(dateOnly).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Semanas seguidas con al menos un entrenamiento, contadas hacia atrás.
 *
 * Es la métrica de constancia para quien entrena tres días por semana: la racha
 * diaria nunca premia a esa persona, aunque lleve un año sin fallar.
 */
function consecutiveWeeks(trainingDays: readonly string[], today: string): number {
  const weeks = new Set(trainingDays.map(weekKey));
  const currentWeek = weekStart(today);

  // Se permite empezar a contar en la semana pasada: el lunes por la mañana
  // nadie ha entrenado todavía esta semana, y su racha seguía intacta el domingo.
  let cursor = weeks.has(weekKey(today)) ? currentWeek : shiftDays(currentWeek, -7);
  let count = 0;
  while (weeks.has(cursor)) {
    count += 1;
    cursor = shiftDays(cursor, -7);
  }
  return count;
}

function weekKey(dateOnly: string): string {
  return weekStart(dateOnly);
}

/** Lunes de la semana de una fecha, en formato ISO. */
function weekStart(dateOnly: string): string {
  const date = toUtcDate(dateOnly);
  const isoDayOfWeek = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - isoDayOfWeek);
  return date.toISOString().slice(0, 10);
}

function shiftDays(dateOnly: string, days: number): string {
  const date = toUtcDate(dateOnly);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDistance(from: string, to: string): number {
  return Math.round(
    (toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000,
  );
}

function toUtcDate(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

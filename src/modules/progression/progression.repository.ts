import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes, Transaction, WhereOptions } from "sequelize";
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
  /** Programas con modo (RF-18). Opcionales: una base sin programas no los tiene. */
  readonly modeBonusPoints?: number;
  readonly overloadWeeksStreak?: number;
  readonly modeMultiplierMax?: number;
  readonly strengthGoalsReached?: number;
  readonly cardioWeeklyStreak?: number;
  /**
   * Segunda tanda de criterios (2026-10-13). Opcionales por lo mismo que los de
   * modo: quien construye unas métricas a mano (pruebas, bases antiguas) no
   * está obligado a conocerlos, y lo que falta cuenta como cero.
   */
  readonly totalTrainingMinutes?: number;
  readonly maxSetWeightKg?: number;
  readonly timedSecondsTotal?: number;
  readonly cardioTotalMinutes?: number;
  readonly cardioTotalKm?: number;
  readonly mondaySessions?: number;
  readonly distinctWeekdays?: number;
  readonly maxSessionsInWeek?: number;
  readonly geoVerifiedSessions?: number;
  readonly supersetSessions?: number;
  readonly routinesCreated?: number;
  readonly routinesPublished?: number;
  readonly routineCopiesReceived?: number;
  readonly commentsWritten?: number;
  readonly ratingsGiven?: number;
  readonly commentLikesReceived?: number;
  /**
   * Tercera tanda (2026-10-18, premios de verdad): comodines de racha, retos de
   * la semana, secretas nuevas y escudo de modo. Opcionales por lo mismo.
   */
  readonly streakFreezes?: number;
  readonly streakFreezesUsed?: number;
  readonly streakFreezesEarned?: number;
  readonly challengesCompleted?: number;
  readonly perfectWeeks?: number;
  /** Puntos de los retos cumplidos más los bonos de semana redonda. */
  readonly challengePoints?: number;
  readonly comebackSessions?: number;
  readonly maxSessionsInDay?: number;
  readonly longestSessionMinutes?: number;
  readonly midnightSessions?: number;
  readonly newYearSessions?: number;
  readonly birthdaySessions?: number;
  readonly maxRecordsInSession?: number;
  readonly modeShieldsUsed?: number;
  readonly modeMaxMultiplierWeeks?: number;
}

/** Lo que la persona hizo fuera del entreno: crear, publicar, comentar, valorar. */
export type CommunityMetrics = Required<
  Pick<
    TrainingMetrics,
    | "routinesCreated"
    | "routinesPublished"
    | "routineCopiesReceived"
    | "commentsWritten"
    | "ratingsGiven"
    | "commentLikesReceived"
  >
>;

interface CommunityMetricsRow {
  routines_created: string;
  routines_published: string;
  routine_copies: string;
  comments: string;
  ratings: string;
  comment_likes: string;
}

interface ModeMetricsRow {
  bonus: string;
  shields_used: string;
  max_multiplier_weeks: string;
  overload_streak: string;
  multiplier_max: string;
  goals: string;
  cardio_streak: string;
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
  total_training_minutes: string | null;
  max_set_weight_kg: string | null;
  timed_seconds_total: string | null;
  cardio_total_minutes: string | null;
  cardio_total_km: string | null;
  monday_sessions: string;
  distinct_weekdays: string;
  max_sessions_in_week: string | null;
  geo_verified_sessions: string;
  superset_sessions: string;
  midnight_sessions: string;
  new_year_sessions: string;
  max_sessions_in_day: string | null;
  longest_session_minutes: string | null;
  birthday_sessions: string;
  max_records_in_session: string | null;
}

/**
 * «Volviste»: días de calendario entre dos sesiones para que la segunda cuente
 * como vuelta. Quince = catorce días enteros sin venir.
 */
const COMEBACK_GAP_DAYS = 15;

/** Tope por sesión al sumar tiempo entrenado: una sesión olvidada abierta no son 40 horas de gimnasio. */
const MAX_SESSION_MINUTES = 240;

/** Por encima de esto una carga es un error de dedo, no una marca. */
const MAX_PLAUSIBLE_SET_KG = 500;

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

  /**
   * Catálogo visible para administrar.
   *
   * `null` (plataforma sin suplantar) ve todo. Un gimnasio ve lo suyo Y lo
   * global: las filas globales son las que heredan sus socios, así que
   * ocultárselas le dejaría administrando una senda que no coincide con la que
   * ven en la aplicación. Editarlas es otra cosa, y eso lo decide el servicio.
   */
  listAllLevels(tenantScope: string | null): Promise<ProgressionLevelModel[]> {
    return this.levelModel.findAll({
      where: catalogScopeWhere(tenantScope),
      order: [
        ["audience", "ASC"],
        ["sortOrder", "ASC"],
      ],
    });
  }

  listAllBadges(tenantScope: string | null): Promise<ProgressionBadgeModel[]> {
    return this.badgeModel.findAll({
      where: catalogScopeWhere(tenantScope),
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
               s.fecha_inicio,
               s.fecha_fin,
               s.fecha_inicio AT TIME ZONE :timeZone AS local_start,
               s.geo_verified,
               LEAST(GREATEST(EXTRACT(EPOCH FROM (s.fecha_fin - s.fecha_inicio)) / 60, 0), :maxSessionMinutes) AS minutos
          FROM public.sesiones_entrenamiento s
         WHERE s.usuario_id = :userId AND s.estado = :finished
      ),
      serie AS (
        SELECT se.sesion_id,
               se.ejercicio_id,
               st.repeticiones,
               st.peso_kg,
               st.duracion_seg,
               st.peso_kg * st.repeticiones AS volumen,
               st.fecha_registro
          FROM public.sesiones_ejercicios se
          JOIN sesion ON sesion.id = se.sesion_id
          JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id
                                             AND st.tipo_serie = 'FUERZA'
      ),
      por_sesion AS (
        SELECT sesion_id, SUM(volumen) AS volumen FROM serie GROUP BY sesion_id
      ),
      -- Un récord personal es una serie que supera a todo lo levantado antes en
      -- ese mismo ejercicio. La primera serie de un ejercicio no lo es: no hay
      -- marca previa que batir, y contarla convertiría «probar algo nuevo» en
      -- «batir un récord».
      historial AS (
        SELECT sesion_id,
               ejercicio_id,
               peso_kg,
               MAX(peso_kg) OVER (
                 PARTITION BY ejercicio_id
                 ORDER BY fecha_registro
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS mejor_previo
          FROM serie
         -- Una serie por tiempo (plancha con lastre) no es un récord de carga.
         WHERE repeticiones IS NOT NULL
      ),
      records AS (
        SELECT DISTINCT ejercicio_id
          FROM historial
         WHERE mejor_previo IS NOT NULL AND peso_kg > mejor_previo
      ),
      -- «Día de récords»: ejercicios distintos con marca nueva dentro de una misma sesión.
      records_por_sesion AS (
        SELECT sesion_id, COUNT(DISTINCT ejercicio_id) AS n
          FROM historial
         WHERE mejor_previo IS NOT NULL AND peso_kg > mejor_previo
         GROUP BY sesion_id
      ),
      -- «Maratón» se mide hasta la última serie apuntada, no hasta el cierre: una
      -- sesión olvidada abierta toda la tarde no es una sesión de dos horas.
      ultima_serie AS (
        SELECT se.sesion_id, MAX(st.fecha_registro) AS ultima
          FROM public.sesiones_ejercicios se
          JOIN sesion ON sesion.id = se.sesion_id
          JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id
         GROUP BY se.sesion_id
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
        (SELECT COUNT(*) FROM records)::text AS personal_records,
        (SELECT COALESCE(SUM(minutos), 0) FROM sesion)::text AS total_training_minutes,
        (SELECT COALESCE(MAX(peso_kg), 0) FROM serie
          WHERE repeticiones IS NOT NULL AND peso_kg <= :maxSetKg)::text AS max_set_weight_kg,
        (SELECT COALESCE(SUM(duracion_seg), 0) FROM serie WHERE repeticiones IS NULL)::text AS timed_seconds_total,
        (SELECT COALESCE(SUM(c.duracion_seg), 0) / 60.0
           FROM public.sesiones_ejercicios se
           JOIN sesion ON sesion.id = se.sesion_id
           JOIN public.series_entrenamiento c ON c.sesion_ejercicio_id = se.id AND c.tipo_serie = 'CARDIO')::text AS cardio_total_minutes,
        (SELECT COALESCE(SUM(c.distancia_m), 0) / 1000.0
           FROM public.sesiones_ejercicios se
           JOIN sesion ON sesion.id = se.sesion_id
           JOIN public.series_entrenamiento c ON c.sesion_ejercicio_id = se.id AND c.tipo_serie = 'CARDIO')::text AS cardio_total_km,
        (SELECT COUNT(*) FROM sesion WHERE EXTRACT(ISODOW FROM local_start) = 1)::text AS monday_sessions,
        (SELECT COUNT(DISTINCT EXTRACT(ISODOW FROM local_start)) FROM sesion)::text AS distinct_weekdays,
        (SELECT COALESCE(MAX(n), 0) FROM (
           SELECT COUNT(*) AS n FROM sesion GROUP BY date_trunc('week', local_start)) por_semana)::text AS max_sessions_in_week,
        (SELECT COUNT(*) FROM sesion WHERE geo_verified IS TRUE)::text AS geo_verified_sessions,
        (SELECT COUNT(DISTINCT se.sesion_id)
           FROM public.sesiones_ejercicios se
           JOIN sesion ON sesion.id = se.sesion_id
          WHERE se.grupo IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.series_entrenamiento st WHERE st.sesion_ejercicio_id = se.id))::text AS superset_sessions,
        (SELECT COUNT(*) FROM sesion WHERE EXTRACT(HOUR FROM local_start) < 4)::text AS midnight_sessions,
        (SELECT COUNT(*) FROM sesion
          WHERE EXTRACT(MONTH FROM local_start) = 1 AND EXTRACT(DAY FROM local_start) = 1)::text AS new_year_sessions,
        (SELECT COALESCE(MAX(n), 0) FROM (
           SELECT COUNT(*) AS n FROM sesion GROUP BY local_start::date) por_dia)::text AS max_sessions_in_day,
        (SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (LEAST(sesion.fecha_fin, u.ultima) - sesion.fecha_inicio)) / 60), 0)
           FROM sesion JOIN ultima_serie u ON u.sesion_id = sesion.id)::text AS longest_session_minutes,
        -- El cumpleaños sale del perfil; sin fecha de nacimiento, simplemente no hay insignia.
        (SELECT COUNT(*) FROM sesion
           JOIN public.perfiles_antropometricos p ON p.usuario_id = :userId
          WHERE p.fecha_nacimiento IS NOT NULL
            AND to_char(local_start, 'MM-DD') = to_char(p.fecha_nacimiento, 'MM-DD'))::text AS birthday_sessions,
        (SELECT COALESCE(MAX(n), 0) FROM records_por_sesion)::text AS max_records_in_session
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId,
          timeZone,
          finished: FINISHED,
          maxSessionMinutes: MAX_SESSION_MINUTES,
          maxSetKg: MAX_PLAUSIBLE_SET_KG,
        },
      },
    );

    // Crear una rutina o comentar no exige haber entrenado: estas métricas se
    // calculan también para quien todavía no tiene ninguna sesión.
    const community = await this.computeCommunityMetrics(userId);

    // Los programas con modo tampoco: una semana fallida cubierta por el escudo
    // existe aunque esa persona no haya terminado ninguna sesión.
    const mode = await this.computeModeMetrics(userId);

    if (!aggregate || Number(aggregate.total_sessions) === 0) {
      return { ...EMPTY_METRICS, ...mode, ...community };
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
      streakFreezes: streaks.freezes,
      streakFreezesUsed: streaks.freezesUsed,
      streakFreezesEarned: streaks.freezesEarned,
      lastSessionOn: trainingDays.at(-1) ?? null,
      firstSessionOn: trainingDays[0] ?? null,
      ...mode,
      totalTrainingMinutes: Number(aggregate.total_training_minutes ?? 0),
      maxSetWeightKg: Number(aggregate.max_set_weight_kg ?? 0),
      timedSecondsTotal: Number(aggregate.timed_seconds_total ?? 0),
      cardioTotalMinutes: Number(aggregate.cardio_total_minutes ?? 0),
      cardioTotalKm: Number(aggregate.cardio_total_km ?? 0),
      mondaySessions: Number(aggregate.monday_sessions),
      distinctWeekdays: Number(aggregate.distinct_weekdays),
      maxSessionsInWeek: Number(aggregate.max_sessions_in_week ?? 0),
      geoVerifiedSessions: Number(aggregate.geo_verified_sessions),
      supersetSessions: Number(aggregate.superset_sessions),
      midnightSessions: Number(aggregate.midnight_sessions),
      newYearSessions: Number(aggregate.new_year_sessions),
      maxSessionsInDay: Number(aggregate.max_sessions_in_day ?? 0),
      longestSessionMinutes: Number(aggregate.longest_session_minutes ?? 0),
      birthdaySessions: Number(aggregate.birthday_sessions),
      maxRecordsInSession: Number(aggregate.max_records_in_session ?? 0),
      comebackSessions: countComebacks(trainingDays),
      ...community,
    };
  }

  /**
   * Rutinas propias (no copias), publicadas y cuántas veces las guardaron, y la
   * participación en la comunidad. Solo cuenta lo que sigue vivo y visible: un
   * comentario retirado por moderación no da insignia.
   */
  private async computeCommunityMetrics(userId: string): Promise<CommunityMetrics> {
    const [row] = await this.sequelize.query<CommunityMetricsRow>(
      `SELECT
         (SELECT COUNT(*) FROM training.routines r
           WHERE r.created_by_user_id = :userId AND r.estado = 'ACTIVE'
             AND r.basada_en_rutina_id IS NULL) AS routines_created,
         (SELECT COUNT(*) FROM training.routines r
           WHERE r.created_by_user_id = :userId AND r.estado = 'ACTIVE'
             AND r.visibilidad = 'PUBLIC' AND r.estado_moderacion = 'VISIBLE') AS routines_published,
         (SELECT COALESCE(SUM(r.copias_total), 0) FROM training.routines r
           WHERE r.created_by_user_id = :userId AND r.estado = 'ACTIVE') AS routine_copies,
         (SELECT COUNT(*) FROM community.content_comments c
           WHERE c.autor_id = :userId AND c.estado = 'VISIBLE') AS comments,
         (SELECT COUNT(*) FROM community.content_ratings v WHERE v.usuario_id = :userId) AS ratings,
         (SELECT COUNT(*) FROM community.comment_likes l
            JOIN community.content_comments c ON c.id = l.comentario_id
           WHERE c.autor_id = :userId AND c.estado = 'VISIBLE' AND l.usuario_id <> :userId) AS comment_likes`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return {
      routinesCreated: Number(row?.routines_created ?? 0),
      routinesPublished: Number(row?.routines_published ?? 0),
      routineCopiesReceived: Number(row?.routine_copies ?? 0),
      commentsWritten: Number(row?.comments ?? 0),
      ratingsGiven: Number(row?.ratings ?? 0),
      commentLikesReceived: Number(row?.comment_likes ?? 0),
    };
  }

  /**
   * Métricas de los programas con modo. El libro solo suma (D8): los puntos de
   * modo nunca bajan. Las rachas son la mayor tanda de semanas CONSECUTIVAS
   * cumplidas (islas: número de semana − posición dentro de las cumplidas).
   */
  private async computeModeMetrics(userId: string) {
    const [row] = await this.sequelize.query<ModeMetricsRow>(
      `SELECT
         COALESCE((SELECT SUM(puntos_bonus) FROM training.mode_reward_ledger WHERE usuario_id = :userId), 0) AS bonus,
         (SELECT count(*) FROM training.program_weeks w JOIN training.training_programs p ON p.id = w.program_id
           WHERE p.usuario_id = :userId AND w.escudo_usado) AS shields_used,
         (SELECT count(*) FROM training.program_weeks w JOIN training.training_programs p ON p.id = w.program_id
           WHERE p.usuario_id = :userId AND p.modo <> 'NONE' AND w.cumplida IS TRUE AND w.multiplicador >= 2) AS max_multiplier_weeks,
         COALESCE((SELECT MAX(run) FROM (
            SELECT count(*) AS run FROM (
              SELECT w.program_id, w.semana_numero - row_number() OVER (PARTITION BY w.program_id ORDER BY w.semana_numero) AS grp
                FROM training.program_weeks w JOIN training.training_programs p ON p.id = w.program_id
               WHERE p.usuario_id = :userId AND p.modo = 'PROGRESSIVE_OVERLOAD' AND w.cumplida IS TRUE) t
             GROUP BY program_id, grp) r), 0) AS overload_streak,
         COALESCE((SELECT MAX(multiplicador) FROM training.mode_reward_ledger WHERE usuario_id = :userId), 0) AS multiplier_max,
         COALESCE((SELECT count(*) FROM training.program_lift_targets t JOIN training.training_programs p ON p.id = t.program_id
                    WHERE p.usuario_id = :userId AND t.alcanzada_en IS NOT NULL), 0) AS goals,
         COALESCE((SELECT MAX(run) FROM (
            SELECT count(*) AS run FROM (
              SELECT w.program_id, w.semana_numero - row_number() OVER (PARTITION BY w.program_id ORDER BY w.semana_numero) AS grp
                FROM training.program_weeks w JOIN training.training_programs p ON p.id = w.program_id
               WHERE p.usuario_id = :userId AND p.carril = 'CARDIO' AND w.minutos_cardio >= 150) t
             GROUP BY program_id, grp) r), 0) AS cardio_streak`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return {
      modeBonusPoints: Number(row?.bonus ?? 0),
      modeShieldsUsed: Number(row?.shields_used ?? 0),
      modeMaxMultiplierWeeks: Number(row?.max_multiplier_weeks ?? 0),
      overloadWeeksStreak: Number(row?.overload_streak ?? 0),
      modeMultiplierMax: Number(row?.multiplier_max ?? 0),
      strengthGoalsReached: Number(row?.goals ?? 0),
      cardioWeeklyStreak: Number(row?.cardio_streak ?? 0),
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

/** Sesiones (días) que llegan tras catorce días o más sin venir. La primera de todas no es una vuelta. */
export function countComebacks(trainingDays: readonly string[]): number {
  let count = 0;
  for (let index = 1; index < trainingDays.length; index += 1) {
    if (dayDistance(trainingDays[index - 1], trainingDays[index]) >= COMEBACK_GAP_DAYS) count += 1;
  }
  return count;
}

export function businessToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Cada cuántos días de racha se gana un comodín, y cuántos se pueden guardar. */
export const STREAK_FREEZE_EVERY_DAYS = 7;
export const STREAK_MAX_FREEZES = 2;

export interface StreakResult {
  /** Racha vigente, ya con comodines aplicados. */
  current: number;
  longest: number;
  /** Semanas seguidas con al menos un entrenamiento. */
  weeks: number;
  /** Comodines guardados ahora mismo (0..2). */
  freezes: number;
  /** Comodines gastados dentro de la racha vigente. */
  freezesUsed: number;
  /** Comodines ganados dentro de la racha vigente: sube aunque se gasten, para poder celebrar «ganaste uno». */
  freezesEarned: number;
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
 *
 * **Comodines** (P3, 2026-10-18): cada 7 días de racha se gana uno, con un
 * máximo de dos guardados. Un día que falta y NO es de descanso gasta uno solo,
 * sin que nadie tenga que pulsar nada, y la racha sigue; el día cubierto no
 * suma, solo no rompe. Si el hueco pide más comodines de los que hay, la racha
 * se corta y los comodines se van con ella: eran de esa racha.
 *
 * Todo sale del historial, sin estado guardado: recalcular dos veces da lo
 * mismo, y corregir una sesión mal registrada recoloca los comodines solos.
 * Los comodines solo pueden alargar rachas, nunca acortarlas, así que la racha
 * más larga —y los puntos que paga— no baja respecto al cálculo anterior.
 */
export function computeStreaks(
  trainingDays: readonly string[],
  today: string,
  restWeekdays: ReadonlySet<number> = new Set(),
): StreakResult {
  if (trainingDays.length === 0) {
    return { current: 0, longest: 0, weeks: 0, freezes: 0, freezesUsed: 0, freezesEarned: 0 };
  }

  let run = { length: 1, freezes: 0, used: 0, earned: 0 };
  let longest = 1;
  for (let index = 1; index < trainingDays.length; index += 1) {
    const missing = missedWorkdays(trainingDays[index - 1], trainingDays[index], restWeekdays);
    run =
      missing <= run.freezes
        ? { ...run, length: run.length + 1, freezes: run.freezes - missing, used: run.used + missing }
        : { length: 1, freezes: 0, used: 0, earned: 0 };
    if (run.length % STREAK_FREEZE_EVERY_DAYS === 0) {
      run = { ...run, earned: run.earned + 1, freezes: Math.min(STREAK_MAX_FREEZES, run.freezes + 1) };
    }
    if (run.length > longest) longest = run.length;
  }

  // Hasta hoy (sin contarlo): los días ya pasados sin entrenar también gastan.
  const pending = missedWorkdays(trainingDays.at(-1)!, today, restWeekdays);
  const alive = pending <= run.freezes;
  const weeks = consecutiveWeeks(trainingDays, today);
  if (!alive) {
    return { current: 0, longest, weeks, freezes: 0, freezesUsed: 0, freezesEarned: 0 };
  }
  return {
    current: run.length,
    longest,
    weeks,
    freezes: run.freezes - pending,
    freezesUsed: run.used + pending,
    freezesEarned: run.earned,
  };
}

/**
 * Días estrictamente entre dos fechas que no son de descanso declarado: los
 * que «faltan». Cero si son consecutivos o si todo el hueco cae en descanso,
 * que es exactamente la tolerancia que ya existía antes de los comodines.
 */
function missedWorkdays(fromDay: string, toDay: string, restWeekdays: ReadonlySet<number>): number {
  const gap = dayDistance(fromDay, toDay);
  let missing = 0;
  for (let offset = 1; offset < gap; offset += 1) {
    if (!restWeekdays.has(isoWeekday(shiftDays(fromDay, offset)))) missing += 1;
  }
  return missing;
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

/**
 * Filas de catálogo que un alcance puede ver: las propias más las compartidas.
 * `null` no filtra —es la plataforma— y devolver `{}` es lo que lo expresa.
 */
function catalogScopeWhere(tenantScope: string | null): WhereOptions {
  if (tenantScope === null) return {};
  return { tenantId: { [Op.or]: [null, tenantScope] } };
}

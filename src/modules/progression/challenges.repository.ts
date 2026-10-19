import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import {
  ChallengeDifficulty,
  ChallengeKind,
  ChallengeSpec,
  EMPTY_WEEK,
  PERFECT_WEEK_BONUS,
  StoredChallenge,
  WeekMeasures,
  addDaysTo,
} from "./weekly-challenges";

interface ChallengeRow {
  code: string;
  kind: ChallengeKind;
  difficulty: ChallengeDifficulty;
  target: string;
  points_reward: number;
  completed_at: Date | null;
  seen: boolean;
}

interface WeekMeasureRow {
  semana: string;
  sessions: string;
  early: string;
  weekend: string;
  geo: string;
  sets: string;
  volume: string;
  cardio_minutes: string;
  muscle_groups: string;
  new_exercises: string;
  records: string;
}

export interface ChallengeTotals {
  completed: number;
  perfectWeeks: number;
  /** Puntos de los retos cumplidos más los bonos de semana redonda. */
  points: number;
  /** Lunes de cada semana redonda, para otorgar los premios atados a ella. */
  perfectWeekStarts: string[];
}

/**
 * Acceso a datos de los retos de la semana.
 *
 * SQL a mano y sin modelo ORM: son filas pequeñas y siempre se leen por
 * (usuario, semana), y la medición es una agregación que Sequelize no expresa.
 */
@Injectable()
export class ChallengesRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async listWeek(userId: string, weekStart: string): Promise<StoredChallenge[]> {
    const rows = await this.sequelize.query<ChallengeRow>(
      `SELECT code, kind, difficulty, target, points_reward, completed_at, seen
         FROM progression.weekly_challenges
        WHERE usuario_id = :userId AND week_start = :weekStart::date`,
      { type: QueryTypes.SELECT, replacements: { userId, weekStart } },
    );
    return rows.map(toStored);
  }

  /**
   * Guarda los retos de una semana. `DO NOTHING`: si dos peticiones llegan a la
   * vez, la generación es determinista y las dos querían escribir lo mismo.
   */
  async insertWeek(userId: string, weekStart: string, specs: readonly ChallengeSpec[]): Promise<void> {
    for (const spec of specs) {
      await this.sequelize.query(
        `INSERT INTO progression.weekly_challenges
           (usuario_id, week_start, code, kind, difficulty, target, points_reward)
         VALUES (:userId, :weekStart::date, :code, :kind, :difficulty, :target, :pointsReward)
         ON CONFLICT (usuario_id, week_start, code) DO NOTHING`,
        { replacements: { userId, weekStart, ...spec } },
      );
    }
  }

  /** Marca como cumplidos los retos dados. Solo la primera vez: la fecha de cumplimiento no se mueve. */
  async markCompleted(userId: string, weekStart: string, codes: readonly string[]): Promise<void> {
    if (codes.length === 0) return;
    await this.sequelize.query(
      `UPDATE progression.weekly_challenges
          SET completed_at = now()
        WHERE usuario_id = :userId AND week_start = :weekStart::date
          AND code IN (:codes) AND completed_at IS NULL`,
      { replacements: { userId, weekStart, codes } },
    );
  }

  async markSeen(userId: string): Promise<void> {
    await this.sequelize.query(
      `UPDATE progression.weekly_challenges SET seen = true
        WHERE usuario_id = :userId AND completed_at IS NOT NULL AND NOT seen`,
      { replacements: { userId } },
    );
  }

  /** Semanas anteriores a `weekStart` con algún reto sin cumplir (a lo sumo la última). */
  async latestOpenWeekBefore(userId: string, weekStart: string): Promise<string | null> {
    const [row] = await this.sequelize.query<{ week: string }>(
      `SELECT to_char(MAX(week_start), 'YYYY-MM-DD') AS week
         FROM progression.weekly_challenges
        WHERE usuario_id = :userId AND week_start < :weekStart::date AND completed_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: { userId, weekStart } },
    );
    return row?.week ?? null;
  }

  /**
   * Totales de toda la historia. Una semana es redonda si tiene sus tres retos
   * cumplidos; se cuenta aquí y no se guarda, para que no pueda desincronizarse.
   */
  async totals(userId: string): Promise<ChallengeTotals> {
    const rows = await this.sequelize.query<{ week: string; done: string; total: string; points: string }>(
      `SELECT to_char(week_start, 'YYYY-MM-DD') AS week,
              COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS done,
              COUNT(*) AS total,
              COALESCE(SUM(points_reward) FILTER (WHERE completed_at IS NOT NULL), 0) AS points
         FROM progression.weekly_challenges
        WHERE usuario_id = :userId
        GROUP BY week_start
        ORDER BY week_start`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const perfectWeekStarts = rows
      .filter((row) => Number(row.total) >= 3 && Number(row.done) === Number(row.total))
      .map((row) => row.week);
    const completed = rows.reduce((sum, row) => sum + Number(row.done), 0);
    const points = rows.reduce((sum, row) => sum + Number(row.points), 0);
    return {
      completed,
      perfectWeeks: perfectWeekStarts.length,
      points: points + perfectWeekStarts.length * PERFECT_WEEK_BONUS,
      perfectWeekStarts,
    };
  }

  /**
   * Lo que midió cada semana entre `fromWeek` (lunes) y `toWeek` (lunes,
   * incluido), en la zona del negocio.
   *
   * Una sola consulta para las cinco semanas que hacen falta (cuatro de
   * historial y la actual). «Ejercicio nuevo» y «marca» miran TODA la historia:
   * nuevo es lo que nunca se había registrado, y una marca es superar todo lo
   * levantado antes, no solo lo de esa semana.
   */
  async measureWeeks(
    userId: string,
    fromWeek: string,
    toWeek: string,
    timeZone: string,
  ): Promise<Map<string, WeekMeasures>> {
    const rows = await this.sequelize.query<WeekMeasureRow>(
      `
      WITH sesion AS (
        SELECT s.id,
               s.fecha_inicio AT TIME ZONE :timeZone AS local_start,
               s.geo_verified
          FROM public.sesiones_entrenamiento s
         WHERE s.usuario_id = :userId AND s.estado = 'FINALIZADA'
      ),
      en_rango AS (
        SELECT id, local_start, geo_verified, date_trunc('week', local_start)::date AS semana
          FROM sesion
         WHERE local_start >= :fromWeek::date AND local_start < :untilDay::date
      ),
      serie AS (
        SELECT se.sesion_id, se.ejercicio_id, st.tipo_serie, st.repeticiones, st.peso_kg,
               st.duracion_seg, st.fecha_registro
          FROM public.sesiones_ejercicios se
          JOIN sesion ON sesion.id = se.sesion_id
          JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id
      ),
      fuerza AS (
        SELECT r.semana, serie.*
          FROM serie JOIN en_rango r ON r.id = serie.sesion_id
         WHERE serie.tipo_serie = 'FUERZA'
      ),
      primeras AS (
        SELECT serie.ejercicio_id, MIN(sesion.local_start) AS primera
          FROM serie JOIN sesion ON sesion.id = serie.sesion_id
         GROUP BY serie.ejercicio_id
      ),
      marcas AS (
        SELECT h.sesion_id, h.ejercicio_id
          FROM (
            SELECT sesion_id, ejercicio_id, peso_kg,
                   MAX(peso_kg) OVER (
                     PARTITION BY ejercicio_id ORDER BY fecha_registro
                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                   ) AS mejor_previo
              FROM serie
             WHERE tipo_serie = 'FUERZA' AND repeticiones IS NOT NULL
          ) h
         WHERE h.mejor_previo IS NOT NULL AND h.peso_kg > h.mejor_previo
      ),
      semanas AS (
        SELECT generate_series(:fromWeek::date, :toWeek::date, interval '7 days')::date AS semana
      )
      SELECT to_char(w.semana, 'YYYY-MM-DD') AS semana,
        (SELECT COUNT(*) FROM en_rango r WHERE r.semana = w.semana) AS sessions,
        (SELECT COUNT(*) FROM en_rango r WHERE r.semana = w.semana AND EXTRACT(HOUR FROM r.local_start) < 9) AS early,
        (SELECT COUNT(*) FROM en_rango r WHERE r.semana = w.semana AND EXTRACT(ISODOW FROM r.local_start) >= 6) AS weekend,
        (SELECT COUNT(*) FROM en_rango r WHERE r.semana = w.semana AND r.geo_verified IS TRUE) AS geo,
        (SELECT COUNT(*) FROM fuerza f WHERE f.semana = w.semana) AS sets,
        (SELECT COALESCE(SUM(f.peso_kg * f.repeticiones), 0) FROM fuerza f WHERE f.semana = w.semana) AS volume,
        (SELECT COALESCE(SUM(serie.duracion_seg), 0) / 60.0
           FROM serie JOIN en_rango r ON r.id = serie.sesion_id
          WHERE r.semana = w.semana AND serie.tipo_serie = 'CARDIO') AS cardio_minutes,
        (SELECT COUNT(DISTINCT mg.code)
           FROM fuerza f
           JOIN training.exercise_muscles em ON em.ejercicio_id = f.ejercicio_id AND em.role = 'PRIMARY'
           JOIN training.muscles m ON m.id = em.muscle_id
           JOIN training.muscle_groups mg ON mg.id = m.muscle_group_id
          WHERE f.semana = w.semana) AS muscle_groups,
        (SELECT COUNT(*) FROM primeras p
          WHERE p.primera >= w.semana AND p.primera < w.semana + 7) AS new_exercises,
        (SELECT COUNT(DISTINCT m.ejercicio_id)
           FROM marcas m JOIN en_rango r ON r.id = m.sesion_id
          WHERE r.semana = w.semana) AS records
        FROM semanas w
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, timeZone, fromWeek, toWeek, untilDay: addDaysTo(toWeek, 7) },
      },
    );
    const byWeek = new Map<string, WeekMeasures>();
    for (const row of rows) {
      byWeek.set(row.semana, {
        ...EMPTY_WEEK,
        SESSIONS: Number(row.sessions),
        EARLY_SESSION: Number(row.early),
        WEEKEND_SESSION: Number(row.weekend),
        GEO_SESSIONS: Number(row.geo),
        SETS: Number(row.sets),
        VOLUME_KG: Number(row.volume),
        CARDIO_MINUTES: Number(row.cardio_minutes),
        MUSCLE_GROUPS: Number(row.muscle_groups),
        NEW_EXERCISE: Number(row.new_exercises),
        PERSONAL_RECORD: Number(row.records),
      });
    }
    return byWeek;
  }
}

function toStored(row: ChallengeRow): StoredChallenge {
  return {
    code: row.code,
    kind: row.kind,
    difficulty: row.difficulty,
    target: Number(row.target),
    pointsReward: Number(row.points_reward),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    seen: row.seen,
  };
}

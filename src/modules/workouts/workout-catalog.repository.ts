import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { AlternativeRow, FreeWorkoutGroup } from './free-workout';

/** Lo que el catálogo puede proponerle a una persona: global o suyo, activo y visible. */
const VISIBLE_TO_USER = `e.estado = 'ACTIVO'
  AND e.estado_moderacion = 'VISIBLE'
  AND (e.tipo_ejercicio = 'GLOBAL'
       OR (e.tipo_ejercicio = 'PERSONAL' AND e.created_by_usuario_id = :userId))`;

/** Miniatura del ejercicio (la misma regla que la lista por músculo). */
const THUMBNAIL_LATERAL = `LEFT JOIN LATERAL (
    SELECT CASE WHEN m.media_type = 'VIDEO' THEN m.thumbnail_url
                ELSE COALESCE(m.thumbnail_url, m.url) END AS url
    FROM training.exercise_media m
    WHERE m.ejercicio_id = e.id
      AND m.status = 'ACTIVE'
      AND (m.media_type IN ('IMAGE', 'GIF')
           OR (m.media_type = 'VIDEO' AND m.thumbnail_url IS NOT NULL))
    ORDER BY (m.media_type = 'VIDEO') ASC, m.is_primary DESC, m.sort_order ASC, m.created_at ASC
    LIMIT 1
  ) img ON TRUE`;

type GroupCandidateRow = { group_code: FreeWorkoutGroup; id: string };

type AlternativeSqlRow = {
  id: string;
  name: string;
  name_es: string | null;
  muscle_group: string;
  equipment: string | null;
  shared: string;
  shared_primary: string;
  recommended: number | null;
  image_url: string | null;
};

export type AlternativeCandidate = AlternativeRow & {
  name: string;
  muscleGroup: string;
  imageUrl: string | null;
};

/**
 * Consultas de catálogo que necesita el entreno libre y el cambio de
 * ejercicio. Viven aquí y no en `exercises` porque dependen de la sesión
 * (qué hay ya en ella, qué prefiere quien entrena).
 */
@Injectable()
export class WorkoutCatalogRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Hasta `perGroup` ejercicios por zona, en orden de preferencia: favoritos de
   * quien entrena, los que trabajan la zona como músculo principal, mejor
   * valorados y con imagen (un ejercicio sin imagen se entiende peor a mitad de
   * entreno).
   */
  async candidatesByGroup(
    userId: string,
    groups: readonly FreeWorkoutGroup[],
    perGroup: number,
  ): Promise<Map<FreeWorkoutGroup, string[]>> {
    const rows = await this.sequelize.query<GroupCandidateRow>(
      `SELECT group_code, id FROM (
         SELECT mg.code AS group_code, e.id,
                ROW_NUMBER() OVER (
                  PARTITION BY mg.code
                  ORDER BY bool_or(COALESCE(p.is_favorite, false)) DESC,
                           bool_or(em.role = 'PRIMARY') DESC,
                           MAX(r.recommended_stars) DESC NULLS LAST,
                           bool_or(img.url IS NOT NULL) DESC,
                           e.nombre ASC
                ) AS rn
         FROM training.exercise_muscles em
         JOIN training.muscles mu ON mu.id = em.muscle_id
         JOIN training.muscle_groups mg ON mg.id = mu.muscle_group_id
         JOIN public.ejercicios e ON e.id = em.ejercicio_id
         LEFT JOIN training.exercise_ratings r ON r.ejercicio_id = e.id
         LEFT JOIN training.user_exercise_preferences p
           ON p.ejercicio_id = e.id AND p.usuario_id = :userId
         ${THUMBNAIL_LATERAL}
         WHERE mg.code IN (:groups) AND ${VISIBLE_TO_USER}
         GROUP BY mg.code, e.id, e.nombre
       ) ranked
       WHERE rn <= :perGroup
       ORDER BY group_code, rn`,
      { type: QueryTypes.SELECT, replacements: { userId, groups, perGroup } },
    );
    return rows.reduce((byGroup, row) => {
      byGroup.set(row.group_code, [...(byGroup.get(row.group_code) ?? []), row.id]);
      return byGroup;
    }, new Map<FreeWorkoutGroup, string[]>());
  }

  /**
   * Equivalentes de un ejercicio: los que comparten músculos (los principales
   * pesan más). Si el ejercicio no tiene músculos enlazados, los de su mismo
   * grupo muscular. Excluye lo que ya está en la sesión.
   */
  async alternativesFor(
    userId: string,
    exerciseId: string,
    excludeIds: readonly string[],
    limit: number,
  ): Promise<AlternativeCandidate[]> {
    const exclude = [...new Set([exerciseId, ...excludeIds])];
    const byMuscle = await this.sequelize.query<AlternativeSqlRow>(
      `SELECT e.id, e.nombre AS name, e.nombre_es AS name_es, e.grupo_muscular AS muscle_group,
              e.required_equipment AS equipment,
              count(*)::text AS shared,
              count(*) FILTER (WHERE em1.role = 'PRIMARY' AND em2.role = 'PRIMARY')::text AS shared_primary,
              MAX(r.recommended_stars) AS recommended,
              MAX(img.url) AS image_url
       FROM training.exercise_muscles em1
       JOIN training.exercise_muscles em2
         ON em2.muscle_id = em1.muscle_id AND em2.ejercicio_id <> em1.ejercicio_id
       JOIN public.ejercicios e ON e.id = em2.ejercicio_id
       LEFT JOIN training.exercise_ratings r ON r.ejercicio_id = e.id
       ${THUMBNAIL_LATERAL}
       WHERE em1.ejercicio_id = :exerciseId
         AND e.id NOT IN (:exclude)
         AND ${VISIBLE_TO_USER}
       GROUP BY e.id, e.nombre, e.nombre_es, e.grupo_muscular, e.required_equipment
       ORDER BY count(*) FILTER (WHERE em1.role = 'PRIMARY' AND em2.role = 'PRIMARY') DESC,
                count(*) DESC, MAX(r.recommended_stars) DESC NULLS LAST
       LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { userId, exerciseId, exclude, limit } },
    );
    const rows = byMuscle.length > 0 ? byMuscle : await this.sameGroupFallback(userId, exerciseId, exclude, limit);
    return rows.map(toCandidate);
  }

  /** Equipo y grupo del ejercicio de partida (para ordenar sus equivalentes). */
  async exerciseEquipment(exerciseId: string): Promise<string | null> {
    const [row] = await this.sequelize.query<{ equipment: string | null }>(
      `SELECT required_equipment AS equipment FROM public.ejercicios WHERE id = :exerciseId`,
      { type: QueryTypes.SELECT, replacements: { exerciseId } },
    );
    return row?.equipment ?? null;
  }

  private sameGroupFallback(
    userId: string,
    exerciseId: string,
    exclude: readonly string[],
    limit: number,
  ): Promise<AlternativeSqlRow[]> {
    return this.sequelize.query<AlternativeSqlRow>(
      `SELECT e.id, e.nombre AS name, e.nombre_es AS name_es, e.grupo_muscular AS muscle_group,
              e.required_equipment AS equipment, '0' AS shared, '0' AS shared_primary,
              r.recommended_stars AS recommended, img.url AS image_url
       FROM public.ejercicios base
       JOIN public.ejercicios e ON lower(e.grupo_muscular) = lower(base.grupo_muscular)
       LEFT JOIN training.exercise_ratings r ON r.ejercicio_id = e.id
       ${THUMBNAIL_LATERAL}
       WHERE base.id = :exerciseId AND e.id <> base.id
         AND e.id NOT IN (:exclude)
         AND ${VISIBLE_TO_USER}
       ORDER BY r.recommended_stars DESC NULLS LAST, e.nombre ASC
       LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { userId, exerciseId, exclude, limit } },
    );
  }
}

function toCandidate(row: AlternativeSqlRow): AlternativeCandidate {
  return {
    id: row.id,
    name: row.name_es?.trim() || row.name,
    muscleGroup: row.muscle_group,
    equipment: row.equipment,
    sharedPrimary: Number(row.shared_primary),
    shared: Number(row.shared),
    recommended: row.recommended,
    imageUrl: row.image_url,
  };
}

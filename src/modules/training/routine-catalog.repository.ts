import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { env } from '../../config/env';
import { QueryTypes } from 'sequelize';
import { RoutineModel } from './routine.model';
import { RoutineCatalogQuery } from './routine-catalog.schemas';

export type CatalogRow = {
  id: string;
  nombre: string;
  descripcion: string | null;
  objetivo: string | null;
  duracion_semanas: number | null;
  visibilidad: string;
  es_oficial: boolean;
  created_by_user_id: string;
  autor_nombre: string;
  version: number;
  valoracion_promedio: string | null;
  valoracion_total: number;
  copias_total: number;
  publicada_en: Date | null;
  atribucion: { routineName: string; authorId: string | null; authorName: string } | null;
  estado_moderacion: string;
  ejercicios_total: number;
  dias: Array<{ diaSemana: number | null; nombre: string | null; ejerciciosTotal: number }>;
  share_id: string | null;
  share_estado: string | null;
  share_origen: string | null;
  share_owner_id: string | null;
  share_owner_nombre: string | null;
};

export type OfficialTemplateRow = CatalogRow & { metadata: Record<string, unknown> | null };

export type RecommendationProfileRow = {
  primary_goal: string | null;
  experience_level: string | null;
  weekly_frequency: number | null;
  training_location: string | null;
  available_equipment: unknown;
  profile_goal: string | null;
};

const ORDER_SQL: Record<RoutineCatalogQuery['orden'], string> = {
  recientes: 'r.publicada_en DESC NULLS LAST, r.created_at DESC, r.id',
  valoradas: 'r.valoracion_promedio DESC NULLS LAST, r.valoracion_total DESC, r.id',
  // Popularidad con decaimiento a 30 días, calculada en SQL (no en memoria).
  populares: `(r.copias_total * 3 + r.activaciones_total * 5
               + r.valoracion_total * COALESCE(r.valoracion_promedio, 0))
              * EXP(-GREATEST(EXTRACT(EPOCH FROM (now() - COALESCE(r.publicada_en, r.created_at))) / 86400, 0) / 30.0) DESC,
              r.id`,
};

/** Columnas de la tarjeta del catálogo (alias `r` = rutina, `u` = autor). */
const CARD_COLUMNS = `r.id, r.nombre, r.descripcion, r.objetivo, r.duracion_semanas, r.visibilidad, r.es_oficial,
             r.created_by_user_id, u.nombre_completo AS autor_nombre, r.version, r.valoracion_promedio,
             r.valoracion_total, r.copias_total, r.publicada_en, r.atribucion, r.estado_moderacion,
             (SELECT count(*)::int FROM training.routine_exercises re WHERE re.routine_id = r.id) AS ejercicios_total,
             COALESCE((SELECT json_agg(json_build_object(
                         'diaSemana', d.dia_semana, 'nombre', d.nombre,
                         'ejerciciosTotal', (SELECT count(*)::int FROM training.routine_exercises x WHERE x.routine_day_id = d.id))
                         ORDER BY d.orden)
                       FROM training.routine_days d WHERE d.routine_id = r.id), '[]'::json) AS dias`;

/** Rutinas de pruebas automáticas fuera de las pestañas públicas (§C6). */
const HIDDEN_PREFIX_CONDITION = 'left(r.nombre, length(:hiddenPrefix)) <> :hiddenPrefix';

/** Consulta del catálogo por pestaña. Siempre filtra visibilidad y moderación en SQL. */
@Injectable()
export class RoutineCatalogRepository {
  constructor(@InjectModel(RoutineModel) private readonly routineModel: typeof RoutineModel) {}

  async list(
    query: RoutineCatalogQuery,
    viewer: { id: string; tenantId: string },
    offset: number,
  ): Promise<CatalogRow[]> {
    const where: string[] = ["r.estado = 'ACTIVE'"];
    let shareJoin = '';
    switch (query.scope) {
      case 'public':
        where.push("r.visibilidad = 'PUBLIC'", "r.estado_moderacion = 'VISIBLE'", 'r.es_oficial = false');
        if (env.CATALOG_HIDDEN_NAME_PREFIX) where.push(HIDDEN_PREFIX_CONDITION);
        break;
      case 'official':
        where.push("r.visibilidad = 'PUBLIC'", "r.estado_moderacion = 'VISIBLE'", 'r.es_oficial = true');
        if (env.CATALOG_HIDDEN_NAME_PREFIX) where.push(HIDDEN_PREFIX_CONDITION);
        break;
      case 'mine':
        where.push('r.created_by_user_id = :userId');
        break;
      case 'shared':
        shareJoin = `JOIN training.routine_shares s ON s.routine_id = r.id AND s.invitado_id = :userId
                       AND s.estado IN ('PENDING','ACCEPTED')
                     JOIN public.usuarios so ON so.id = s.propietario_id`;
        where.push("(s.estado = 'PENDING' OR r.estado_moderacion = 'VISIBLE')");
        break;
    }
    if (query.q) where.push('r.nombre ILIKE :q');
    if (query.objetivo) where.push('r.objetivo = :objetivo');
    if (query.deMiGimnasio) where.push('r.tenant_id_autor = :tenantId');
    if (query.diasPorSemana) {
      where.push('(SELECT count(*) FROM training.routine_days dd WHERE dd.routine_id = r.id) = :diasPorSemana');
    }
    const sharedCols =
      query.scope === 'shared'
        ? 's.id AS share_id, s.estado AS share_estado, s.origen AS share_origen, s.propietario_id AS share_owner_id, so.nombre_completo AS share_owner_nombre'
        : 'NULL::uuid AS share_id, NULL AS share_estado, NULL AS share_origen, NULL::uuid AS share_owner_id, NULL AS share_owner_nombre';

    const sql = `
      SELECT ${CARD_COLUMNS},
             ${sharedCols}
        FROM training.routines r
        JOIN public.usuarios u ON u.id = r.created_by_user_id
        ${shareJoin}
       WHERE ${where.join(' AND ')}
       ORDER BY ${ORDER_SQL[query.orden]}
       LIMIT :limitPlusOne OFFSET :offset`;

    return this.routineModel.sequelize!.query<CatalogRow>(sql, {
      type: QueryTypes.SELECT,
      replacements: {
        userId: viewer.id,
        tenantId: viewer.tenantId,
        q: query.q ? `%${query.q.replace(/[%_\\]/gu, (c) => `\\${c}`)}%` : null,
        objetivo: query.objetivo ?? null,
        diasPorSemana: query.diasPorSemana ?? null,
        limitPlusOne: query.limit + 1,
        offset,
        hiddenPrefix: env.CATALOG_HIDDEN_NAME_PREFIX ?? null,
      },
    });
  }

  /**
   * Plantillas candidatas a «Para ti»: oficiales, públicas, visibles y con
   * `metadata.plantilla` (las 20 de REPP). Son pocas: se filtran en memoria con
   * la regla pura de `routine-recommendation.ts`.
   */
  listOfficialTemplates(): Promise<OfficialTemplateRow[]> {
    return this.routineModel.sequelize!.query<OfficialTemplateRow>(
      `SELECT ${CARD_COLUMNS}, r.metadata,
              NULL::uuid AS share_id, NULL AS share_estado, NULL AS share_origen,
              NULL::uuid AS share_owner_id, NULL AS share_owner_nombre
         FROM training.routines r
         JOIN public.usuarios u ON u.id = r.created_by_user_id
        WHERE r.estado = 'ACTIVE' AND r.visibilidad = 'PUBLIC' AND r.estado_moderacion = 'VISIBLE'
          AND r.es_oficial = true AND r.metadata->>'plantilla' IS NOT NULL
          ${env.CATALOG_HIDDEN_NAME_PREFIX ? `AND ${HIDDEN_PREFIX_CONDITION}` : ''}
        ORDER BY r.id
        LIMIT 200`,
      { type: QueryTypes.SELECT, replacements: { hiddenPrefix: env.CATALOG_HIDDEN_NAME_PREFIX ?? null } },
    );
  }

  /** Lo que la regla necesita de la persona: onboarding y, si no, el objetivo del perfil. */
  async findRecommendationProfile(userId: string): Promise<RecommendationProfileRow | null> {
    const rows = await this.routineModel.sequelize!.query<RecommendationProfileRow>(
      `SELECT o.primary_goal, o.experience_level, o.weekly_frequency, o.training_location,
              o.available_equipment, p.objetivo AS profile_goal
         FROM public.usuarios u
         LEFT JOIN profile.onboarding o ON o.user_id = u.id
         LEFT JOIN public.perfiles_antropometricos p ON p.usuario_id = u.id
        WHERE u.id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return rows[0] ?? null;
  }
}

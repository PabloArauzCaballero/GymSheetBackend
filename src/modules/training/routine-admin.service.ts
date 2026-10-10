import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { RoutineVisibility, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { RoutinePublicationService } from './routine-publication.service';
import { RoutineResponse } from './training.mapper';
import { TrainingRepository } from './training.repository';
import { TrainingService } from './training.service';
import { CreateRoutineInput } from './training.schemas';
import { AdminRoutineListQuery } from './routine-v2.schemas';

type Actor = { id: string; role: UserRole; tenantId: string };

/** Gestión REPP de rutinas oficiales y vistas de backoffice (RF-B2). */
@Injectable()
export class RoutineAdminService {
  constructor(
    private readonly trainingService: TrainingService,
    private readonly publication: RoutinePublicationService,
    private readonly repository: TrainingRepository,
    private readonly sequelize: Sequelize,
  ) {}

  private assertSystemAdmin(actor: Actor): void {
    if (actor.role !== UserRole.SYSTEM_ADMIN) {
      throw new DomainException(403, 'OFFICIAL_FORBIDDEN', 'Solo REPP puede gestionar rutinas oficiales.');
    }
  }

  /** Crea una rutina directamente como oficial («Recomendada por REPP»). */
  async createOfficial(actor: Actor, input: CreateRoutineInput): Promise<RoutineResponse> {
    this.assertSystemAdmin(actor);
    if (!input.days) throw new BadRequestException('Una rutina oficial necesita días y ejercicios.');
    const created = await this.trainingService.createRoutine(actor, input);
    await this.publication.publish(actor, created.id);
    return this.setOfficial(actor, created.id, true);
  }

  async setOfficial(actor: Actor, routineId: string, official: boolean): Promise<RoutineResponse> {
    this.assertSystemAdmin(actor);
    const routine = await this.repository.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    if (official && (routine.visibility !== RoutineVisibility.PUBLIC || routine.moderationState !== 'VISIBLE')) {
      throw new BadRequestException('Solo una rutina pública y visible puede ser oficial.');
    }
    await routine.update({ isOfficial: official });
    return this.trainingService.getRoutineForUser(actor, routineId);
  }

  /** Listado para la consola: oficiales, ocultas, por autor o por texto. */
  async list(query: AdminRoutineListQuery, tenantScope: string | null) {
    // Un ADMIN de gimnasio solo ve las rutinas de autores de su gimnasio.
    const where: string[] = [tenantScope ? 'r.tenant_id_autor = :tenantScope' : 'TRUE'];
    if (query.oficial !== undefined) where.push('r.es_oficial = :oficial');
    if (query.estadoModeracion) where.push('r.estado_moderacion = :estadoModeracion');
    if (query.autor) where.push('r.created_by_user_id = :autor');
    if (query.q) where.push('r.nombre ILIKE :q');
    const offset = query.cursor ? Number(Buffer.from(query.cursor, 'base64url').toString('utf8')) || 0 : 0;
    const rows = await this.sequelize.query<Record<string, unknown>>(
      `SELECT r.id, r.nombre, r.visibilidad, r.es_oficial AS "esOficial", r.estado,
              r.estado_moderacion AS "estadoModeracion", r.version, r.copias_total AS copias,
              r.valoracion_promedio AS "valoracionPromedio", r.valoracion_total AS "valoracionTotal",
              r.publicada_en AS "publicadaEn", u.id AS "autorId", u.nombre_completo AS "autorNombre",
              (SELECT count(*)::int FROM moderation.reports m
                WHERE m.target_kind = 'ROUTINE' AND m.target_id = r.id
                  AND m.status IN ('PENDIENTE','EN_REVISION')) AS "denunciasAbiertas"
         FROM training.routines r JOIN public.usuarios u ON u.id = r.created_by_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.es_oficial DESC, r.updated_at DESC, r.id
        LIMIT :limitPlusOne OFFSET :offset`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          tenantScope,
          oficial: query.oficial ?? null,
          estadoModeracion: query.estadoModeracion ?? null,
          autor: query.autor ?? null,
          q: query.q ? `%${query.q.replace(/[%_\\]/gu, (c) => `\\${c}`)}%` : null,
          limitPlusOne: query.limit + 1,
          offset,
        },
      },
    );
    return {
      items: rows.slice(0, query.limit),
      siguienteCursor:
        rows.length > query.limit
          ? Buffer.from(String(offset + query.limit), 'utf8').toString('base64url')
          : null,
    };
  }

  async insights(routineId: string, tenantScope: string | null) {
    const [row] = await this.sequelize.query<Record<string, unknown>>(
      `SELECT r.id, r.nombre, r.version, r.copias_total AS copias, r.activaciones_total AS activaciones,
              r.valoracion_promedio AS "valoracionPromedio", r.valoracion_total AS "valoracionTotal",
              (SELECT count(*)::int FROM community.content_comments c
                WHERE c.target_kind = 'ROUTINE' AND c.target_id = r.id AND c.estado = 'VISIBLE') AS comentarios,
              (SELECT count(*)::int FROM moderation.reports m
                WHERE m.target_kind = 'ROUTINE' AND m.target_id = r.id) AS denuncias,
              (SELECT count(*)::int FROM training.routines k
                WHERE k.basada_en_rutina_id = r.id AND k.estado = 'ACTIVE') AS "copiasVivas"
         FROM training.routines r
        WHERE r.id = :routineId AND (:tenantScope::text IS NULL OR r.tenant_id_autor = :tenantScope)`,
      { type: QueryTypes.SELECT, replacements: { routineId, tenantScope } },
    );
    if (!row) throw new NotFoundException('Rutina no encontrada.');
    return row;
  }
}

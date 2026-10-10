import { Injectable } from '@nestjs/common';
import { FitnessGoal, TrainingGoal } from '../../common/enums/domain.enums';
import {
  CatalogRow,
  OfficialTemplateRow,
  RecommendationProfileRow,
  RoutineCatalogRepository,
} from './routine-catalog.repository';
import { decodeCursor, encodeCursor, RoutineCatalogQuery } from './routine-catalog.schemas';
import {
  ExperienceLevel,
  RecommendationCandidate,
  RecommendationProfile,
  recommendRoutines,
  TemplateLevelValue,
  TrainingLocation,
} from './routine-recommendation';

export type RoutineCardResponse = {
  id: string;
  nombre: string;
  descripcion: string | null;
  objetivo: string | null;
  duracionSemanas: number | null;
  diasPorSemana: number;
  ejerciciosTotal: number | null;
  visibilidad: string;
  esOficial: boolean;
  esMia: boolean;
  autor: { id: string; nombre: string };
  atribucion: CatalogRow['atribucion'];
  basadaEnRutinaId: string | null;
  numeroCopia: number | null;
  valoracion: { promedio: number | null; total: number };
  copias: number;
  publicadaEn: Date | null;
  version: number;
  estadoModeracion: string;
  dias: Array<{ diaSemana: number | null; nombre: string | null; ejerciciosTotal: number | null }>;
  invitacion: {
    id: string;
    estado: string;
    origen: string;
    deParte: { id: string; nombre: string };
  } | null;
};

export type RoutineCatalogPage = { items: RoutineCardResponse[]; siguienteCursor: string | null };

export type RecommendedRoutineResponse = {
  rutina: RoutineCardResponse;
  motivo: string;
  /** `metadata` de la plantilla: nivel, lugar, equipo, minutos, plantilla, subobjetivo, aviso… */
  plantilla: Record<string, unknown>;
};

type TemplateCandidate = RecommendationCandidate & { row: OfficialTemplateRow };

const LEVELS: readonly TemplateLevelValue[] = ['PRINCIPIANTE', 'INTERMEDIO', 'AVANZADO', 'TODOS'];
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

@Injectable()
export class RoutineCatalogService {
  constructor(private readonly repository: RoutineCatalogRepository) {}

  async list(
    viewer: { id: string; tenantId: string },
    query: RoutineCatalogQuery,
  ): Promise<RoutineCatalogPage> {
    const offset = decodeCursor(query.cursor);
    const rows = await this.repository.list(query, viewer, offset);
    const hasMore = rows.length > query.limit;
    return {
      items: rows.slice(0, query.limit).map((row) => this.toCard(row, viewer.id)),
      siguienteCursor: hasMore ? encodeCursor(offset + query.limit) : null,
    };
  }

  /** «Para ti» (§C7): hasta `limit` plantillas oficiales con su motivo. */
  async recommended(viewer: { id: string }, limit: number): Promise<RecommendedRoutineResponse[]> {
    const [profileRow, templates] = await Promise.all([
      this.repository.findRecommendationProfile(viewer.id),
      this.repository.listOfficialTemplates(),
    ]);
    const picks = recommendRoutines(this.toProfile(profileRow), templates.map((row) => this.toCandidate(row)), limit);
    return picks.map(({ candidate, motivo }) => ({
      rutina: this.toCard(candidate.row, viewer.id),
      motivo,
      plantilla: candidate.row.metadata ?? {},
    }));
  }

  private toProfile(row: RecommendationProfileRow | null): RecommendationProfile {
    return {
      primaryGoal: oneOf(row?.primary_goal, Object.values(FitnessGoal)),
      profileGoal: oneOf(row?.profile_goal, Object.values(TrainingGoal)),
      level: oneOf<ExperienceLevel>(row?.experience_level, ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
      weeklyFrequency: row?.weekly_frequency ?? null,
      location: oneOf<TrainingLocation>(row?.training_location, ['GYM', 'HOME', 'OUTDOORS', 'MIXED']),
      equipment: strings(row?.available_equipment),
    };
  }

  private toCandidate(row: OfficialTemplateRow): TemplateCandidate {
    const meta = row.metadata ?? {};
    return {
      row,
      id: row.id,
      plantilla: String(meta.plantilla),
      objetivo: oneOf(row.objetivo, Object.values(TrainingGoal)),
      subobjetivo: typeof meta.subobjetivo === 'string' ? meta.subobjetivo : null,
      nivel: oneOf(meta.nivel, LEVELS) ?? 'TODOS',
      lugar: strings(meta.lugar),
      equipo: strings(meta.equipo),
      dias: row.dias.length,
      valoracion: row.valoracion_promedio == null ? null : Number(row.valoracion_promedio),
      copias: row.copias_total,
      soloSiObjetivo: meta.soloSiObjetivo === true,
    };
  }

  private toCard(row: CatalogRow, viewerId: string): RoutineCardResponse {
    // Con la invitación sin aceptar solo se ve la tarjeta: nombre, autor y días, sin ejercicios.
    const pending = row.share_estado === 'PENDING';
    return {
      id: row.id,
      nombre: row.nombre,
      descripcion: row.descripcion,
      objetivo: row.objetivo,
      duracionSemanas: row.duracion_semanas,
      diasPorSemana: row.dias.length,
      ejerciciosTotal: pending ? null : row.ejercicios_total,
      visibilidad: row.visibilidad,
      esOficial: row.es_oficial,
      esMia: row.created_by_user_id === viewerId,
      autor: { id: row.created_by_user_id, nombre: row.autor_nombre },
      atribucion: row.atribucion,
      basadaEnRutinaId: row.basada_en_rutina_id,
      numeroCopia: row.numero_copia,
      valoracion: {
        promedio: row.valoracion_promedio == null ? null : Number(row.valoracion_promedio),
        total: row.valoracion_total,
      },
      copias: row.copias_total,
      publicadaEn: row.publicada_en,
      version: row.version,
      estadoModeracion: row.estado_moderacion,
      dias: row.dias.map((d) => ({ ...d, ejerciciosTotal: pending ? null : d.ejerciciosTotal })),
      invitacion: row.share_id
        ? {
            id: row.share_id,
            estado: row.share_estado ?? 'PENDING',
            origen: row.share_origen ?? 'INVITACION',
            deParte: { id: row.share_owner_id ?? '', nombre: row.share_owner_nombre ?? '' },
          }
        : null,
    };
  }
}

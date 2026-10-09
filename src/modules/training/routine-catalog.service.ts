import { Injectable } from '@nestjs/common';
import { CatalogRow, RoutineCatalogRepository } from './routine-catalog.repository';
import { decodeCursor, encodeCursor, RoutineCatalogQuery } from './routine-catalog.schemas';

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

import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

export type AdminUserRow = {
  id: string;
  nombreCompleto: string;
  email: string;
  rol: string;
  estado: string;
  tenantId: string | null;
  ultimaSesion: string | null;
  total: string;
};

/** `%` and `_` typed in the search box are literal characters, not wildcards. */
function likeFragment(value: string): string {
  return `%${value.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

/** Reads of `public.usuarios` for REPP's account console. */
@Injectable()
export class AdminUsersRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * One page of accounts by name or email fragment, roles and status, ordered
   * by name with the id as tie-breaker (two namesakes never swap pages). The
   * total travels on every row (`COUNT(*) OVER ()`), so count and page come
   * from the same read. The last session is looked up only for the page.
   */
  search(input: { q: string | null; roles: string[] | null; status: string | null; tenantScope: string | null; limit: number; offset: number }) {
    return this.sequelize.query<AdminUserRow>(
      `WITH page AS (
         SELECT u.id, u.nombre_completo, u.email, u.rol, u.estado, u.tenant_id, COUNT(*) OVER () AS total
           FROM public.usuarios u
          WHERE (CAST(:tenantScope AS text) IS NULL OR u.tenant_id = :tenantScope)
            AND (CAST(:roles AS text[]) IS NULL OR u.rol = ANY(CAST(:roles AS text[])))
            AND (CAST(:status AS text) IS NULL OR u.estado = :status)
            AND (CAST(:pattern AS text) IS NULL OR u.email ILIKE :pattern OR u.nombre_completo ILIKE :pattern)
          ORDER BY u.nombre_completo, u.id
          LIMIT :limit OFFSET :offset)
       SELECT p.id, p.nombre_completo AS "nombreCompleto", p.email, p.rol, p.estado, p.tenant_id AS "tenantId",
              (SELECT to_char(max(s.fecha_inicio), 'YYYY-MM-DD') FROM public.sesiones_entrenamiento s WHERE s.usuario_id = p.id) AS "ultimaSesion",
              p.total
         FROM page p
        ORDER BY p.nombre_completo, p.id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          tenantScope: input.tenantScope,
          roles: input.roles ? `{${input.roles.join(',')}}` : null,
          status: input.status,
          pattern: input.q ? likeFragment(input.q) : null,
          limit: input.limit,
          offset: input.offset,
        },
      },
    );
  }
}

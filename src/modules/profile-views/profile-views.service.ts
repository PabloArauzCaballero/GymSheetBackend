import { Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { UsersRepository } from "../users/users.repository";
import {
  decodeProfileViewersCursor,
  encodeProfileViewersCursor,
} from "./profile-views.cursor";
import {
  ProfileViewersPageResponse,
  mapProfileViewerToResponse,
} from "./profile-views.mapper";
import { ProfileViewsRepository, ProfileViewsSummaryRow } from "./profile-views.repository";
import { ProfileViewersQuery } from "./profile-views.schemas";

@Injectable()
export class ProfileViewsService {
  constructor(
    private readonly repository: ProfileViewsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  /**
   * Se ignoran en silencio, sin error: verse a uno mismo o a alguien de otro
   * tenant no es un mal pedido del cliente, solo no hay nada que registrar.
   */
  async record(viewerId: string, viewerTenantId: string, viewedUserId: string): Promise<void> {
    if (viewerId === viewedUserId) return;
    const viewedUser = await this.usersRepository.findActiveById(viewedUserId);
    if (!viewedUser) return;
    const viewedTenantId = viewedUser.tenantId ?? env.DEFAULT_TENANT_ID;
    if (viewedTenantId !== viewerTenantId) return;
    await this.repository.record(viewerId, viewedUserId, viewerTenantId);
  }

  /**
   * Quién vio mi perfil, una fila por persona.
   *
   * Se piden `limit + 1` filas y la sobrante no se devuelve: sirve sólo para
   * saber si hay página siguiente. Sin ella habría que emitir cursor siempre
   * que la página venga llena, y el cliente descubriría el final con una
   * petición de más que vuelve vacía.
   *
   * La marca de "última revisión" se lee aparte, pero es una sola lectura por
   * clave primaria para toda la página, no una por espectador: la lista sigue
   * siendo una consulta y esto no la convierte en N+1.
   */
  async listViewers(
    userId: string,
    tenantId: string,
    query: ProfileViewersQuery,
  ): Promise<ProfileViewersPageResponse> {
    // Antes de tocar la base: un cursor manipulado muere aquí como 400.
    const cursor = query.cursor ? decodeProfileViewersCursor(query.cursor) : null;

    const [rows, checkedAt] = await Promise.all([
      this.repository.listViewers(userId, tenantId, env.DEFAULT_TENANT_ID, {
        limit: query.limit + 1,
        cursor,
      }),
      this.repository.findCheckedAt(userId),
    ]);

    const hasMore = rows.length > query.limit;
    const viewers = hasMore ? rows.slice(0, query.limit) : rows;
    const last = viewers[viewers.length - 1];

    return {
      viewers: viewers.map((row) => mapProfileViewerToResponse(row, checkedAt)),
      nextCursor:
        hasMore && last
          ? encodeProfileViewersCursor({ lastViewedAt: last.lastViewedAt, userId: last.userId })
          : null,
    };
  }

  summary(userId: string, tenantId: string): Promise<ProfileViewsSummaryRow> {
    return this.repository.summaryFor(userId, tenantId, env.DEFAULT_TENANT_ID);
  }

  /**
   * Marca la lista como revisada. Idempotente: repetirlo sólo adelanta la
   * fecha, así que un doble toque en el cliente no rompe nada.
   */
  async markChecked(userId: string): Promise<{ checked: true }> {
    await this.repository.markChecked(userId);
    return { checked: true };
  }
}

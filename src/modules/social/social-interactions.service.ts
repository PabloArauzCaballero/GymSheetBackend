import { Injectable, NotFoundException } from "@nestjs/common";
import { env } from "../../config/env";
import {
  mapInteractionCountsToResponse,
  mapLikeInteractionToResponse,
  mapPassInteractionToResponse,
  type InteractionCountsResponse,
  type LikeInteractionResponse,
  type PassInteractionResponse,
} from "./social.mapper";
import type { DirectoryRow, LikeInteractionRow, PassInteractionRow } from "./social.repository";
import { SocialRepository } from "./social.repository";
import type { InteractionListQuery } from "./social.schemas";

/**
 * Las cuatro caras de una interacción: quién me dio like, a quién se lo di,
 * quién me dio next y a quién se lo di.
 *
 * DECISIÓN DE PRODUCTO — «quién me dio next» se expone a propósito.
 * La mayoría de las apps del sector esconde los descartes recibidos, y por una
 * razón defendible: enterarse de quién te descartó no cambia nada que puedas
 * hacer y sí puede doler. Aquí se enseña porque se pidió explícitamente, y se
 * enseña con un límite claro: `passes-received` es de **sólo lectura**. Desde
 * esa lista no hay ninguna acción posible sobre la otra persona —ni deshacer su
 * descarte, ni volver a ofrecerle la carta, ni avisarle de que lo miraste—.
 * La única operación de escritura de este servicio es borrar el descarte
 * *propio* (`deletePass`), que es revertir una decisión de uno mismo. Si algún
 * día alguien añade aquí un endpoint que actúe sobre quien me descartó, estará
 * cambiando esta decisión, no completándola.
 *
 * Todas las listas se pintan con la ficha de la baraja
 * (`SocialRepository.directory`) y no con SQL propio: así el filtro de tenant,
 * la exclusión de bajas y cualquier campo nuevo del perfil valen en las cinco
 * pantallas a la vez, sin que nadie tenga que acordarse de replicarlo.
 */
@Injectable()
export class SocialInteractionsService {
  constructor(private readonly repository: SocialRepository) {}

  async likesReceived(
    viewerId: string,
    tenantId: string,
    query: InteractionListQuery,
  ): Promise<LikeInteractionResponse[]> {
    const rows = await this.repository.listLikesReceived(viewerId, query.limit);
    return this.withLikeCards(viewerId, tenantId, rows);
  }

  async likesSent(
    viewerId: string,
    tenantId: string,
    query: InteractionListQuery,
  ): Promise<LikeInteractionResponse[]> {
    const rows = await this.repository.listLikesSent(viewerId, query.limit);
    return this.withLikeCards(viewerId, tenantId, rows);
  }

  async passesReceived(
    viewerId: string,
    tenantId: string,
    query: InteractionListQuery,
  ): Promise<PassInteractionResponse[]> {
    const rows = await this.repository.listPassesReceived(viewerId, query.limit);
    return this.withPassCards(viewerId, tenantId, rows);
  }

  async passesSent(
    viewerId: string,
    tenantId: string,
    query: InteractionListQuery,
  ): Promise<PassInteractionResponse[]> {
    const rows = await this.repository.listPassesSent(viewerId, query.limit);
    return this.withPassCards(viewerId, tenantId, rows);
  }

  /**
   * Devuelve a alguien a la baraja borrando el descarte propio.
   *
   * Sin descarte no hay nada que borrar y se responde 404, igual que si el
   * usuario no existiera: quien pregunta no puede distinguir «nunca lo
   * descarté» de «esa persona no está», y no tiene por qué poder.
   */
  async deletePass(viewerId: string, targetUserId: string): Promise<{ deleted: true }> {
    const removed = await this.repository.deletePass(viewerId, targetUserId);
    if (removed === 0) throw new NotFoundException("No hay ningún descarte sobre esa persona.");
    return { deleted: true };
  }

  async counts(viewerId: string, tenantId: string): Promise<InteractionCountsResponse> {
    const row = await this.repository.countInteractions(viewerId, tenantId, env.DEFAULT_TENANT_ID);
    return mapInteractionCountsToResponse(row);
  }

  private async withLikeCards(
    viewerId: string,
    tenantId: string,
    rows: readonly LikeInteractionRow[],
  ): Promise<LikeInteractionResponse[]> {
    const cards = await this.cardsFor(viewerId, tenantId, rows);
    return rows.flatMap((row) => {
      const card = cards.get(row.userId);
      return card ? [mapLikeInteractionToResponse(card, row.connectionId, row.likedAt)] : [];
    });
  }

  private async withPassCards(
    viewerId: string,
    tenantId: string,
    rows: readonly PassInteractionRow[],
  ): Promise<PassInteractionResponse[]> {
    const cards = await this.cardsFor(viewerId, tenantId, rows);
    return rows.flatMap((row) => {
      const card = cards.get(row.userId);
      return card ? [mapPassInteractionToResponse(card, row.passedAt)] : [];
    });
  }

  /**
   * Las fichas de todas las personas de la lista, en una sola consulta.
   *
   * El `flatMap` de quien llama no es un descarte silencioso de errores: es el
   * filtro de seguridad. `directory()` sólo devuelve a socios activos del mismo
   * gimnasio, así que una baja o alguien que se cambió de sede simplemente no
   * trae ficha y desaparece de la lista. Ese es el comportamiento que se busca:
   * no hay 403 ni hueco vacío, esa persona ya no existe para quien pregunta.
   *
   * El orden lo pone la lista de interacciones (ya viene por fecha descendente
   * desde la base), no el `ORDER BY` alfabético de `directory()`: por eso se
   * recorre `rows` y se busca la ficha, y no al revés.
   */
  private async cardsFor(
    viewerId: string,
    tenantId: string,
    rows: readonly { userId: string }[],
  ): Promise<Map<string, DirectoryRow>> {
    const userIds = rows.map((row) => row.userId);
    const cards = await this.repository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
      limit: userIds.length,
      userIds,
    });
    return new Map(cards.map((card) => [card.userId, card]));
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Transaction, UniqueConstraintError } from "sequelize";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { UserModel } from "../users/user.model";
import { UsersRepository } from "../users/users.repository";
import {
  mapConnectionToResponse,
  mapDirectoryRowToResponse,
  mapMemberProfileToResponse,
  type ConnectionResponse,
  type DirectoryEntryResponse,
  type MemberProfileResponse,
  type SwipeResponse,
  type UndoSwipeResponse,
} from "./social.mapper";
import { SocialRepository } from "./social.repository";
import type {
  DirectoryQuery,
  DiscoveryDeckQuery,
  RespondConnectionInput,
  SwipeInput,
  UpdateSocialStatusInput,
} from "./social.schemas";

@Injectable()
export class SocialService {
  constructor(
    private readonly repository: SocialRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async sendConnection(
    requesterId: string,
    requesterTenantId: string,
    addresseeId: string,
    transaction?: Transaction,
  ): Promise<ConnectionResponse> {
    if (requesterId === addresseeId) {
      throw new BadRequestException("No puedes enviarte una solicitud a ti mismo.");
    }
    const addressee = await this.requireSameTenantMember(addresseeId, requesterTenantId);

    const existing = await this.repository.findActiveBetween(
      requesterId,
      addresseeId,
      transaction,
    );
    if (existing) {
      // La otra persona ya había mandado la suya: aceptarla en vez de sumar
      // una segunda fila es lo que un socio esperaría al tocar «conectar».
      if (existing.status === ConnectionStatus.PENDING && existing.requesterId === addresseeId) {
        const accepted = await this.repository.respond(
          existing,
          ConnectionStatus.ACCEPTED,
          transaction,
        );
        return mapConnectionToResponse(accepted, requesterId, addressee.fullName);
      }
      throw new ConflictException(
        existing.status === ConnectionStatus.ACCEPTED
          ? "Ya están conectados."
          : "Ya existe una solicitud pendiente entre ustedes.",
      );
    }

    const created = await this.repository.create(requesterId, addresseeId, transaction);
    return mapConnectionToResponse(created, requesterId, addressee.fullName);
  }

  /**
   * El socio, siempre que sea del mismo gimnasio y esté activo.
   *
   * Mismo 404 para «no existe» y «existe en otro gimnasio»: no confirmamos la
   * existencia de cuentas fuera del tenant de quien pregunta.
   */
  private async requireSameTenantMember(userId: string, tenantId: string): Promise<UserModel> {
    const member = await this.usersRepository.findActiveById(userId);
    if (!member || (member.tenantId ?? env.DEFAULT_TENANT_ID) !== tenantId) {
      throw new NotFoundException("Usuario no encontrado.");
    }
    return member;
  }

  async respondConnection(
    connectionId: string,
    userId: string,
    input: RespondConnectionInput,
  ): Promise<ConnectionResponse> {
    const connection = await this.repository.findByIdForUser(connectionId, userId);
    if (!connection) throw new NotFoundException("Solicitud no encontrada.");
    // Solo quien la recibió puede aceptarla o rechazarla; quien la envió solo
    // puede retirarla (borrarla), que es una acción distinta.
    if (connection.addresseeId !== userId) {
      throw new NotFoundException("Solicitud no encontrada.");
    }
    if (connection.status !== ConnectionStatus.PENDING) {
      throw new ConflictException("Esta solicitud ya fue respondida.");
    }

    const nextStatus =
      input.action === "ACCEPT" ? ConnectionStatus.ACCEPTED : ConnectionStatus.REJECTED;
    const updated = await this.repository.respond(connection, nextStatus);
    const names = await this.repository.namesFor([connection.requesterId]);
    return mapConnectionToResponse(updated, userId, names.get(connection.requesterId) ?? "");
  }

  async withdrawConnection(connectionId: string, userId: string): Promise<{ deleted: true }> {
    const connection = await this.repository.findByIdForUser(connectionId, userId);
    if (!connection) throw new NotFoundException("Solicitud no encontrada.");
    if (connection.requesterId !== userId) {
      throw new NotFoundException("Solicitud no encontrada.");
    }
    await connection.destroy();
    return { deleted: true };
  }

  async listConnections(
    userId: string,
    status?: "PENDING" | "ACCEPTED" | "REJECTED",
  ): Promise<ConnectionResponse[]> {
    const connections = await this.repository.listForUser(
      userId,
      status as ConnectionStatus | undefined,
    );
    const otherIds = connections.map((connection) =>
      connection.requesterId === userId ? connection.addresseeId : connection.requesterId,
    );
    const names = await this.repository.namesFor(otherIds);
    return connections.map((connection) => {
      const otherId = connection.requesterId === userId ? connection.addresseeId : connection.requesterId;
      return mapConnectionToResponse(connection, userId, names.get(otherId) ?? "");
    });
  }

  async isConnected(userIdA: string, userIdB: string): Promise<boolean> {
    const connection = await this.repository.findActiveBetween(userIdA, userIdB);
    return connection?.status === ConnectionStatus.ACCEPTED;
  }

  async getSocialStatus(userId: string): Promise<{ socialStatus: string | null; visible: boolean }> {
    const settings = await this.repository.getSettings(userId);
    return { socialStatus: settings?.socialStatus ?? null, visible: settings?.visible ?? false };
  }

  async updateSocialStatus(
    userId: string,
    input: UpdateSocialStatusInput,
  ): Promise<{ socialStatus: string | null; visible: boolean }> {
    const settings = await this.repository.upsertSettings(userId, input);
    return { socialStatus: settings.socialStatus, visible: settings.visible };
  }

  /**
   * El estado social de otra persona, solo si son conexión aceptada y esa
   * persona lo marcó visible. Cualquier otro caso responde `null`, nunca un
   * error: preguntar por alguien con quien no tienes conexión no es un mal
   * pedido, solo no hay nada que mostrar.
   */
  async viewSocialStatus(viewerId: string, targetUserId: string): Promise<string | null> {
    const connected = await this.isConnected(viewerId, targetUserId);
    if (!connected) return null;
    const settings = await this.repository.getSettings(targetUserId);
    if (!settings?.visible) return null;
    return settings.socialStatus;
  }

  async directory(
    userId: string,
    tenantId: string,
    query: DirectoryQuery,
  ): Promise<DirectoryEntryResponse[]> {
    const rows = await this.repository.directory(userId, tenantId, env.DEFAULT_TENANT_ID, {
      objetivo: query.objetivo,
      branchId: query.sucursalId,
      gender: query.genero,
      search: query.q,
      limit: query.limit,
    });
    return rows.map(mapDirectoryRowToResponse);
  }

  /**
   * El perfil social de un socio del mismo gimnasio.
   *
   * Las insignias se leen directamente de lo ya otorgado; deliberadamente no
   * pasa por `ProgressionService.getProgression`, que recalcula la senda y
   * concede insignias y recompensas de racha. Mirar el perfil de otra persona
   * no puede modificar su progreso.
   */
  async memberProfile(
    viewerId: string,
    tenantId: string,
    targetUserId: string,
  ): Promise<MemberProfileResponse> {
    const [row] = await this.repository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
      limit: 1,
      targetUserId,
    });
    // La consulta ya filtra por tenant y excluye la propia cuenta: si no vino
    // nada, para quien pregunta esa persona no existe.
    if (!row) throw new NotFoundException("Usuario no encontrado.");

    const badges = await this.repository.listEarnedBadges(targetUserId);
    return mapMemberProfileToResponse(row, badges);
  }

  /**
   * La baraja de descubrimiento: candidatos del mismo gimnasio sobre los que
   * el viewer todavía no ha decidido nada.
   *
   * Se ordena por puntos y no alfabéticamente como el directorio: una baraja se
   * mira de una en una, así que el orden decide qué se ve, no solo dónde está.
   */
  async discoveryDeck(
    viewerId: string,
    tenantId: string,
    query: DiscoveryDeckQuery,
  ): Promise<DirectoryEntryResponse[]> {
    const rows = await this.repository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
      objetivo: query.objetivo,
      branchId: query.sucursalId,
      gender: query.genero,
      search: query.q,
      limit: query.limit,
      excludeDecided: true,
      orderBy: "points",
    });
    return rows.map(mapDirectoryRowToResponse);
  }

  /**
   * Un swipe sobre una carta de la baraja.
   *
   * «Me gusta» no inventa un modelo nuevo: es la solicitud de conexión de
   * siempre, y `sendConnection` ya acepta sola la que venía de vuelta — eso,
   * exactamente, es el match.
   */
  async swipe(viewerId: string, tenantId: string, input: SwipeInput): Promise<SwipeResponse> {
    if (viewerId === input.targetId) {
      throw new BadRequestException("No puedes hacer swipe sobre ti mismo.");
    }
    const target = await this.requireSameTenantMember(input.targetId, tenantId);

    try {
      return await this.repository.runInTransaction<SwipeResponse>(async (transaction) => {
        if (input.direction === "PASS") {
          await this.repository.createPass(viewerId, target.id, transaction);
          return { direction: "PASS", targetId: target.id, matched: false, connectionId: null };
        }

        // Si antes lo había descartado, el descarte deja de valer: sin borrarlo,
        // deshacer este «me gusta» devolvería la carta a un limbo —sin conexión
        // pero invisible en la baraja— del que no habría forma de sacarla.
        await this.repository.deletePass(viewerId, target.id, transaction);
        const connection = await this.sendConnection(viewerId, tenantId, target.id, transaction);
        return {
          direction: "LIKE",
          targetId: target.id,
          matched: connection.status === ConnectionStatus.ACCEPTED,
          connectionId: connection.id,
        };
      });
    } catch (error) {
      // Dos swipes simultáneos sobre la misma pareja chocan contra el índice
      // único; eso es un conflicto, no un fallo del servidor.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException("Ya existe una solicitud entre ustedes.");
      }
      throw error;
    }
  }

  /**
   * Deshace el último swipe del viewer.
   *
   * Qué fue el último se deduce comparando las fechas que el propio swipe ya
   * deja (`discovery_passes.created_at`, `connections.created_at` y
   * `connections.responded_at`); ver `SocialRepository.findLastSwipe`. Como
   * enviar o aceptar una solicitud desde el directorio es la misma acción de
   * dominio que un «me gusta», deshacer también las alcanza — que es lo
   * coherente: se revierte la última decisión social, venga de la pantalla que
   * venga.
   */
  async undoLastSwipe(viewerId: string): Promise<UndoSwipeResponse> {
    return this.repository.runInTransaction<UndoSwipeResponse>(async (transaction) => {
      const last = await this.repository.findLastSwipe(viewerId, transaction);
      if (!last) throw new NotFoundException("No hay ningún swipe que deshacer.");

      if (last.kind === "PASS") {
        await this.repository.deletePass(viewerId, last.targetId, transaction);
        return { undone: "PASS", targetId: last.targetId, connectionId: null, unmatched: false };
      }

      const connection = last.connectionId
        ? await this.repository.findByIdForUser(last.connectionId, viewerId, transaction)
        : null;
      if (!connection) throw new NotFoundException("No hay ningún swipe que deshacer.");

      const matched = connection.status === ConnectionStatus.ACCEPTED;
      if (matched) {
        // Un match del que ya salió una conversación no es un swipe que se
        // pueda «desver»: borrarlo dejaría a la otra persona hablando sola.
        const hasMessages = await this.repository.directConversationHasMessages(
          viewerId,
          last.targetId,
          transaction,
        );
        if (hasMessages) {
          throw new ConflictException(
            "Ya hay mensajes en la conversación: este match no se puede deshacer.",
          );
        }
      }

      if (last.kind === "LIKE_SENT") {
        await connection.destroy({ transaction });
      } else {
        // La solicitud era de la otra persona: deshacer el match la devuelve a
        // pendiente, no la borra. Nadie retiró lo que no envió.
        await this.repository.revertToPending(connection, transaction);
      }

      return {
        undone: "LIKE",
        targetId: last.targetId,
        connectionId: connection.id,
        unmatched: matched,
      };
    });
  }
}

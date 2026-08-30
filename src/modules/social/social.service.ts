import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { UsersRepository } from "../users/users.repository";
import {
  mapConnectionToResponse,
  mapDirectoryRowToResponse,
  type ConnectionResponse,
  type DirectoryEntryResponse,
} from "./social.mapper";
import { SocialRepository } from "./social.repository";
import type { DirectoryQuery, RespondConnectionInput, UpdateSocialStatusInput } from "./social.schemas";

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
  ): Promise<ConnectionResponse> {
    if (requesterId === addresseeId) {
      throw new BadRequestException("No puedes enviarte una solicitud a ti mismo.");
    }
    const addressee = await this.usersRepository.findActiveById(addresseeId);
    // Mismo 404 para "no existe" y "existe en otro gimnasio": no confirmamos
    // la existencia de cuentas fuera del tenant del solicitante.
    if (!addressee || (addressee.tenantId ?? env.DEFAULT_TENANT_ID) !== requesterTenantId) {
      throw new NotFoundException("Usuario no encontrado.");
    }

    const existing = await this.repository.findActiveBetween(requesterId, addresseeId);
    if (existing) {
      // La otra persona ya había mandado la suya: aceptarla en vez de sumar
      // una segunda fila es lo que un socio esperaría al tocar «conectar».
      if (existing.status === ConnectionStatus.PENDING && existing.requesterId === addresseeId) {
        const accepted = await this.repository.respond(existing, ConnectionStatus.ACCEPTED);
        return mapConnectionToResponse(accepted, requesterId, addressee.fullName);
      }
      throw new ConflictException(
        existing.status === ConnectionStatus.ACCEPTED
          ? "Ya están conectados."
          : "Ya existe una solicitud pendiente entre ustedes.",
      );
    }

    const created = await this.repository.create(requesterId, addresseeId);
    return mapConnectionToResponse(created, requesterId, addressee.fullName);
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
}

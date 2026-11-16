import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { UniqueConstraintError } from "sequelize";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { UserModel } from "../users/user.model";
import { UsersRepository } from "../users/users.repository";
import { ChatEventsService } from "../chat/chat-events.service";
import { ChatRepository } from "../chat/chat.repository";
import {
  mapConnectionToResponse,
  mapDirectoryRowToResponse,
  mapMemberProfileToResponse,
  type ConnectionResponse,
  type DirectoryEntryResponse,
  type DiscoveryCardResponse,
  type MemberProfileResponse,
  type SwipeResponse,
  type UndoSwipeResponse,
} from "./social.mapper";
import { SocialRepository } from "./social.repository";
import { NotificationService } from "../notifications/notification.service";
import { RecommendationsClient } from "./recommendations-client";
import { applySocialDiscoverySettings } from "./social-discovery-settings.policy";
import { DiscoveryDeckFlow } from "./discovery-deck.flow";
import { DiscoveryRankingService } from "./discovery-ranking.service";
import type { DeckPage } from "./discovery-remote-deck";
import { SocialMatchFlow } from "./social-match.flow";
import type {
  DirectoryQuery,
  DiscoveryDeckQuery,
  RespondConnectionInput,
  SwipeInput,
  UpdateSocialStatusInput,
  UpdateSocialDiscoverySettingsInput,
  DiscoveryPreferencesInput,
} from "./social.schemas";

@Injectable()
export class SocialService {
  private readonly matches: SocialMatchFlow;
  private readonly deck: DiscoveryDeckFlow;

  constructor(
    private readonly repository: SocialRepository,
    private readonly usersRepository: UsersRepository,
    private readonly chatEvents: ChatEventsService,
    @Optional() private readonly recommendations?: RecommendationsClient,
    @Optional() private readonly notifications?: NotificationService,
    @Optional()
    @Inject(forwardRef(() => ChatRepository))
    private readonly chatRepository?: ChatRepository,
    @Optional() private readonly ranking?: DiscoveryRankingService,
  ) {
    this.matches = new SocialMatchFlow({
      repository,
      usersRepository,
      notifications: () => this.notifications,
      chatRepository: () => this.chatRepository,
    });
    // The external ranker is an override only when it is actually configured;
    // otherwise every deck request would rank twice (pool + local fallback).
    const remoteConfigured = Boolean(env.RECOMMENDATIONS_URL && env.RECOMMENDATIONS_SERVICE_TOKEN);
    this.deck = new DiscoveryDeckFlow({
      repository,
      recommendations: ranking && !remoteConfigured ? undefined : recommendations,
      ranking,
      crossGymEnabled: (userId) => this.crossGymDiscoveryEnabled(userId),
    });
  }

  /** Directory/map "connect" is a LIKE (single match model, F5.01). */
  async sendConnection(
    requesterId: string,
    requesterTenantId: string,
    addresseeId: string,
  ): Promise<ConnectionResponse> {
    const outcome = await this.repository.runInTransaction((transaction) =>
      this.matches.like(requesterId, requesterTenantId, addresseeId, transaction),
    );
    this.recordDecision(requesterId, addresseeId, "LIKE", outcome.matched);
    return mapConnectionToResponse(outcome.connection, requesterId, outcome.target.fullName);
  }

  private async requireSocialCandidate(
    viewerId: string,
    targetId: string,
    tenantId: string,
  ): Promise<UserModel> {
    const member = await this.usersRepository.findActiveById(targetId);
    if (!member) throw new NotFoundException("Usuario no encontrado.");
    const memberTenantId = member.tenantId ?? env.DEFAULT_TENANT_ID;
    if (
      memberTenantId !== tenantId &&
      !(await this.repository.canInteractAcrossTenants(viewerId, targetId))
    ) {
      throw new NotFoundException("Usuario no encontrado.");
    }
    return member;
  }

  private async crossGymDiscoveryEnabled(userId: string): Promise<boolean> {
    const settings = await this.repository.discoverySettings(userId);
    return settings.profileEnabled && settings.crossGymEnabled;
  }

  private recordDecision(
    viewerId: string,
    targetId: string,
    direction: "LIKE" | "PASS",
    matched: boolean,
    impressionId?: string,
  ): void {
    void this.ranking?.recordDecision({ viewerId, targetId, impressionId, direction, matched });
  }

  /**
   * ACCEPT from the likes panel is a LIKE back (same domain path as a swipe);
   * REJECT keeps its own meaning.
   */
  async respondConnection(
    connectionId: string,
    userId: string,
    input: RespondConnectionInput,
  ): Promise<ConnectionResponse> {
    const response = await this.repository.runInTransaction(async (transaction) => {
      const candidate = await this.repository.findByIdForUser(
        connectionId,
        userId,
        transaction,
        false,
      );
      if (!candidate || candidate.addresseeId !== userId) {
        throw new NotFoundException("Solicitud no encontrada.");
      }
      await this.repository.lockSocialPair(
        candidate.requesterId,
        candidate.addresseeId,
        transaction,
      );
      const connection = await this.repository.findByIdForUser(
        connectionId,
        userId,
        transaction,
      );
      if (!connection || connection.addresseeId !== userId) {
        throw new NotFoundException("Solicitud no encontrada.");
      }
      if (connection.status !== ConnectionStatus.PENDING) {
        throw new ConflictException("Esta solicitud ya fue respondida.");
      }
      if (input.action === "ACCEPT") {
        const actor = await this.usersRepository.findActiveById(userId, transaction);
        if (!actor) throw new NotFoundException("Solicitud no encontrada.");
        const outcome = await this.matches.like(
          userId,
          actor.tenantId ?? env.DEFAULT_TENANT_ID,
          connection.requesterId,
          transaction,
          connection,
        );
        return mapConnectionToResponse(outcome.connection, userId, outcome.target.fullName);
      }
      const rejected = await this.repository.respond(
        connection,
        ConnectionStatus.REJECTED,
        transaction,
      );
      const names = await this.repository.namesFor([connection.requesterId], transaction);
      return mapConnectionToResponse(
        rejected,
        userId,
        names.get(connection.requesterId) ?? "",
      );
    });
    if (input.action === "ACCEPT") {
      this.recordDecision(userId, response.otherUserId, "LIKE", true);
    }
    return response;
  }

  async withdrawConnection(
    connectionId: string,
    userId: string,
  ): Promise<{ deleted: true }> {
    const result = await this.repository.revokeConnection(connectionId, userId);
    if (!result)
      throw new NotFoundException("Solicitud o conexión no encontrada.");
    for (const conversationId of result.conversationIds) {
      this.chatEvents.emitConversationRevoked(conversationId);
    }
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
      connection.requesterId === userId
        ? connection.addresseeId
        : connection.requesterId,
    );
    const names = await this.repository.namesFor(otherIds);
    return connections.map((connection) => {
      const otherId =
        connection.requesterId === userId
          ? connection.addresseeId
          : connection.requesterId;
      return mapConnectionToResponse(
        connection,
        userId,
        names.get(otherId) ?? "",
      );
    });
  }

  async isConnected(userIdA: string, userIdB: string): Promise<boolean> {
    if (await this.repository.isBlockedEitherWay(userIdA, userIdB))
      return false;
    const connection = await this.repository.findActiveBetween(
      userIdA,
      userIdB,
    );
    return connection?.status === ConnectionStatus.ACCEPTED;
  }

  async blockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ blocked: true }> {
    if (blockerId === blockedId)
      throw new BadRequestException("No puedes bloquearte a ti mismo.");
    const target = await this.usersRepository.findActiveById(blockedId);
    if (!target) throw new NotFoundException("Usuario no encontrado.");
    const conversationIds = await this.repository.blockUser(
      blockerId,
      blockedId,
    );
    for (const conversationId of conversationIds)
      this.chatEvents.emitConversationRevoked(conversationId);
    return { blocked: true };
  }

  async unblockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ unblocked: true }> {
    await this.repository.unblockUser(blockerId, blockedId);
    return { unblocked: true };
  }

  listBlockedUsers(blockerId: string) {
    return this.repository.listBlockedUsers(blockerId);
  }

  async getSocialStatus(
    userId: string,
  ): Promise<{ socialStatus: string | null; visible: boolean }> {
    const settings = await this.repository.getSettings(userId);
    return {
      socialStatus: settings?.socialStatus ?? null,
      visible: settings?.visible ?? false,
    };
  }

  async updateSocialStatus(
    userId: string,
    input: UpdateSocialStatusInput,
  ): Promise<{ socialStatus: string | null; visible: boolean }> {
    const settings = await this.repository.upsertSettings(userId, input);
    return { socialStatus: settings.socialStatus, visible: settings.visible };
  }

  getDiscoverySettings(userId: string) {
    return this.repository.discoverySettings(userId);
  }

  async updateDiscoverySettings(
    userId: string,
    input: UpdateSocialDiscoverySettingsInput,
  ) {
    const current = await this.repository.discoverySettings(userId);
    let next: ReturnType<typeof applySocialDiscoverySettings>;
    try {
      next = applySocialDiscoverySettings(
        current,
        {
          profileEnabled: input.profileEnabled,
          crossGymEnabled: input.crossGymEnabled,
          mapEnabled: input.mapEnabled,
          version: current.version,
        },
        input.expectedVersion,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "SOCIAL_SETTINGS_VERSION_CONFLICT"
      ) {
        throw new ConflictException(
          "Los permisos sociales cambiaron. Recarga e intenta otra vez.",
        );
      }
      throw new BadRequestException(
        "El perfil social debe estar activo para habilitar otros espacios.",
      );
    }
    const saved = await this.repository.updateDiscoverySettings(
      userId,
      next,
      input.expectedVersion,
    );
    if (!saved)
      throw new ConflictException(
        "Los permisos sociales cambiaron. Recarga e intenta otra vez.",
      );
    return saved;
  }

  getDiscoveryPreferences(userId: string) {
    return this.repository.discoveryPreferences(userId);
  }

  async updateDiscoveryPreferences(
    userId: string,
    input: DiscoveryPreferencesInput,
  ) {
    const saved = await this.repository.updateDiscoveryPreferences(
      userId,
      input,
    );
    if (!saved)
      throw new ConflictException(
        "Las preferencias cambiaron. Recarga e intenta otra vez.",
      );
    return saved;
  }

  /**
   * El estado social de otra persona, solo si son conexión aceptada y esa
   * persona lo marcó visible. Cualquier otro caso responde `null`, nunca un
   * error: preguntar por alguien con quien no tienes conexión no es un mal
   * pedido, solo no hay nada que mostrar.
   */
  async viewSocialStatus(
    viewerId: string,
    targetUserId: string,
  ): Promise<string | null> {
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
    const includeCrossGym = await this.crossGymDiscoveryEnabled(userId);
    const rows = await this.repository.directory(
      userId,
      tenantId,
      env.DEFAULT_TENANT_ID,
      {
        objetivo: query.objetivo,
        branchId: query.sucursalId,
        gender: query.genero,
        search: query.q,
        limit: query.limit,
        includeCrossGym,
      },
    );
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
    const includeCrossGym = await this.crossGymDiscoveryEnabled(viewerId);
    const [row] = await this.repository.directory(
      viewerId,
      tenantId,
      env.DEFAULT_TENANT_ID,
      {
        limit: 1,
        targetUserId,
        includeCrossGym,
      },
    );
    // La consulta ya filtra por tenant y excluye la propia cuenta: si no vino
    // nada, para quien pregunta esa persona no existe.
    if (!row) throw new NotFoundException("Usuario no encontrado.");

    const badges = await this.repository.listEarnedBadges(targetUserId);
    return mapMemberProfileToResponse(row, badges);
  }

  /**
   * The "Conocer" deck, ranked locally by default (see `DiscoveryDeckFlow` and
   * `discovery-ranking.sql.ts`). Gamification points are not a ranking input.
   */
  async discoveryDeck(
    viewerId: string,
    tenantId: string,
    query: DiscoveryDeckQuery,
  ): Promise<DiscoveryCardResponse[]> {
    return (await this.deck.page(viewerId, tenantId, query)).items;
  }

  discoveryDeckPage(
    viewerId: string,
    tenantId: string,
    query: DiscoveryDeckQuery,
  ): Promise<DeckPage> {
    return this.deck.page(viewerId, tenantId, query);
  }


  async observeDiscoveryImpression(
    viewerId: string,
    tenantId: string,
    impressionId: string,
  ): Promise<{ observed: true }> {
    const impression = await this.repository.getDiscoveryImpression(
      viewerId,
      impressionId,
    );
    if (!impression)
      throw new NotFoundException("Impresión de Conocer no encontrada.");
    await this.requireSocialCandidate(viewerId, impression.targetId, tenantId);
    const observed = await this.repository.runInTransaction((transaction) =>
      this.repository.observeDiscoveryImpression(
        viewerId,
        impressionId,
        transaction,
      ),
    );
    if (!observed)
      throw new NotFoundException("Impresión de Conocer no encontrada.");
    return { observed: true };
  }

  /**
   * A swipe on a deck card. LIKE is the single match model (`SocialMatchFlow`):
   * a mutual like is the match. The impression is optional at decision time.
   */
  async swipe(
    viewerId: string,
    tenantId: string,
    input: SwipeInput,
  ): Promise<SwipeResponse> {
    if (viewerId === input.targetId) {
      throw new BadRequestException("No puedes hacer swipe sobre ti mismo.");
    }
    const target = await this.requireSocialCandidate(viewerId, input.targetId, tenantId);

    let response: SwipeResponse;
    try {
      response = await this.repository.runInTransaction<SwipeResponse>(async (transaction) => {
        const featureCodes = input.impressionId
          ? await this.repository.consumeDiscoveryImpression(
              viewerId,
              target.id,
              input.impressionId,
              input.direction,
              transaction,
            )
          : null;
        if (input.impressionId && featureCodes === null) {
          throw new ConflictException("La impresión expiró o ya fue utilizada.");
        }
        const signal = (kind: "LIKE" | "MUTUAL" | "PASS") =>
          input.impressionId && featureCodes?.length
            ? this.repository.enqueueRecommendationSignal(
                { viewerId, profileId: target.id, impressionId: input.impressionId, kind, featureCodes },
                transaction,
              )
            : Promise.resolve();
        if (input.direction === "PASS") {
          await this.repository.createPass(viewerId, target.id, transaction);
          await signal("PASS");
          return { direction: "PASS", targetId: target.id, matched: false, connectionId: null };
        }
        const outcome = await this.matches.like(viewerId, tenantId, target.id, transaction);
        await signal("LIKE");
        if (outcome.matched) await signal("MUTUAL");
        return {
          direction: "LIKE",
          targetId: target.id,
          matched: outcome.matched,
          connectionId: outcome.connection.id,
        };
      });
    } catch (error) {
      // Two simultaneous swipes on the same pair hit the unique index: that is
      // a conflict, not a server failure.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException("Ya existe una solicitud entre ustedes.");
      }
      throw error;
    }
    this.recordDecision(viewerId, target.id, response.direction, response.matched, input.impressionId);
    return response;
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
    return this.repository.runInTransaction<UndoSwipeResponse>(
      async (transaction) => {
        const last = await this.repository.findLastSwipe(viewerId, transaction);
        if (!last)
          throw new NotFoundException("No hay ningún swipe que deshacer.");

        if (last.kind === "PASS") {
          await this.repository.deletePass(
            viewerId,
            last.targetId,
            transaction,
          );
          if (typeof this.repository.retractLatestDiscoverySignal === "function") {
            await this.repository.retractLatestDiscoverySignal(
              viewerId,
              last.targetId,
              "PASS",
              transaction,
            );
          }
          return {
            undone: "PASS",
            targetId: last.targetId,
            connectionId: null,
            unmatched: false,
          };
        }

        const connection = last.connectionId
          ? await this.repository.findByIdForUser(
              last.connectionId,
              viewerId,
              transaction,
            )
          : null;
        if (!connection)
          throw new NotFoundException("No hay ningún swipe que deshacer.");

        const matched = connection.status === ConnectionStatus.ACCEPTED;
        if (matched) {
          // Un match del que ya salió una conversación no es un swipe que se
          // pueda «desver»: borrarlo dejaría a la otra persona hablando sola.
          const hasMessages =
            await this.repository.directConversationHasMessages(
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
          if (matched && typeof this.repository.cancelTrainingInvitesForPair === "function") {
            await this.repository.cancelTrainingInvitesForPair(
              last.targetId,
              viewerId,
              transaction,
            );
          }
          // La solicitud era de la otra persona: deshacer el match la devuelve a
          // pendiente, no la borra. Nadie retiró lo que no envió.
          await this.repository.revertToPending(connection, transaction);
        }

        if (typeof this.repository.retractLatestDiscoverySignal === "function") {
          await this.repository.retractLatestDiscoverySignal(
            viewerId,
            last.targetId,
            "LIKE",
            transaction,
          );
        }

        return {
          undone: "LIKE",
          targetId: last.targetId,
          connectionId: connection.id,
          unmatched: matched,
        };
      },
    );
  }
}

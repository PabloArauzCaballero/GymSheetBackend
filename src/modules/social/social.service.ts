import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Transaction, UniqueConstraintError } from "sequelize";
import {
  ConnectionStatus,
  NotificationChannel,
} from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { UserModel } from "../users/user.model";
import { UsersRepository } from "../users/users.repository";
import { ChatEventsService } from "../chat/chat-events.service";
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
import { DirectoryRow, SocialRepository } from "./social.repository";
import { NotificationService } from "../notifications/notification.service";
import { RecommendationsClient } from "./recommendations-client";
import { recommendationFeatureCodes } from "./recommendation-feature-codes";
import { applySocialDiscoverySettings } from "./social-discovery-settings.policy";
import {
  discoveryCursorContext,
  issueDiscoveryCursor,
  readDiscoveryCursor,
} from "./discovery-deck.cursor";
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
  constructor(
    private readonly repository: SocialRepository,
    private readonly usersRepository: UsersRepository,
    private readonly chatEvents: ChatEventsService,
    @Optional() private readonly recommendations?: RecommendationsClient,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async sendConnection(
    requesterId: string,
    requesterTenantId: string,
    addresseeId: string,
    transaction?: Transaction,
  ): Promise<ConnectionResponse> {
    if (requesterId === addresseeId) {
      throw new BadRequestException(
        "No puedes enviarte una solicitud a ti mismo.",
      );
    }
    if (!transaction) {
      return this.repository.runInTransaction((tx) =>
        this.sendConnection(requesterId, requesterTenantId, addresseeId, tx),
      );
    }
    await this.repository.lockSocialPair(requesterId, addresseeId, transaction);
    if (
      await this.repository.isBlockedEitherWay(
        requesterId,
        addresseeId,
        transaction,
      )
    ) {
      throw new NotFoundException("Usuario no encontrado.");
    }
    const addressee = await this.usersRepository.findActiveById(
      addresseeId,
      transaction,
    );
    if (!addressee) throw new NotFoundException("Usuario no encontrado.");
    const addresseeTenantId = addressee.tenantId ?? env.DEFAULT_TENANT_ID;
    if (
      addresseeTenantId !== requesterTenantId &&
      !(await this.repository.canInteractAcrossTenants(
        requesterId,
        addresseeId,
        transaction,
      ))
    ) {
      throw new NotFoundException("Usuario no encontrado.");
    }

    const existing = await this.repository.findActiveBetween(
      requesterId,
      addresseeId,
      transaction,
    );
    if (existing) {
      // La otra persona ya había mandado la suya: aceptarla en vez de sumar
      // una segunda fila es lo que un socio esperaría al tocar «conectar».
      if (
        existing.status === ConnectionStatus.PENDING &&
        existing.requesterId === addresseeId
      ) {
        const accepted = await this.repository.respond(
          existing,
          ConnectionStatus.ACCEPTED,
          transaction,
        );
        await this.enqueueConnectionAcceptedNotice(existing, transaction);
        return mapConnectionToResponse(
          accepted,
          requesterId,
          addressee.fullName,
        );
      }
      throw new ConflictException(
        existing.status === ConnectionStatus.ACCEPTED
          ? "Ya están conectados."
          : "Ya existe una solicitud pendiente entre ustedes.",
      );
    }

    const created = await this.repository.create(
      requesterId,
      addresseeId,
      transaction,
    );
    return mapConnectionToResponse(created, requesterId, addressee.fullName);
  }

  /**
   * El socio, siempre que sea del mismo gimnasio y esté activo.
   *
   * Mismo 404 para «no existe» y «existe en otro gimnasio»: no confirmamos la
   * existencia de cuentas fuera del tenant de quien pregunta.
   */
  private async requireSameTenantMember(
    userId: string,
    tenantId: string,
  ): Promise<UserModel> {
    const member = await this.usersRepository.findActiveById(userId);
    if (!member || (member.tenantId ?? env.DEFAULT_TENANT_ID) !== tenantId) {
      throw new NotFoundException("Usuario no encontrado.");
    }
    return member;
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

  async respondConnection(
    connectionId: string,
    userId: string,
    input: RespondConnectionInput,
  ): Promise<ConnectionResponse> {
    return this.repository.runInTransaction(async (transaction) => {
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
        if (
          await this.repository.isBlockedEitherWay(
            userId,
            connection.requesterId,
            transaction,
          )
        ) {
          throw new NotFoundException("Solicitud no encontrada.");
        }
        const [actor, requester] = await Promise.all([
          this.usersRepository.findActiveById(userId, transaction),
          this.usersRepository.findActiveById(
            connection.requesterId,
            transaction,
          ),
        ]);
        if (!actor || !requester)
          throw new NotFoundException("Solicitud no encontrada.");
        const actorTenantId = actor.tenantId ?? env.DEFAULT_TENANT_ID;
        const requesterTenantId = requester.tenantId ?? env.DEFAULT_TENANT_ID;
        if (
          actorTenantId !== requesterTenantId &&
          !(await this.repository.canInteractAcrossTenants(
            userId,
            connection.requesterId,
            transaction,
          ))
        ) {
          throw new NotFoundException("Solicitud no encontrada.");
        }
      }

      const nextStatus =
        input.action === "ACCEPT"
          ? ConnectionStatus.ACCEPTED
          : ConnectionStatus.REJECTED;
      const updated = await this.repository.respond(
        connection,
        nextStatus,
        transaction,
      );
      if (input.action === "ACCEPT") {
        await this.enqueueConnectionAcceptedNotice(connection, transaction);
      }
      const names = await this.repository.namesFor(
        [connection.requesterId],
        transaction,
      );
      return mapConnectionToResponse(
        updated,
        userId,
        names.get(connection.requesterId) ?? "",
      );
    });
  }

  private async enqueueConnectionAcceptedNotice(
    connection: { id: string; requesterId: string },
    transaction: Transaction,
  ): Promise<void> {
    if (!this.notifications) return;
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: connection.requesterId,
        channel: NotificationChannel.IN_APP,
        subject: "Solicitud de conexión aceptada",
        body: "Tu solicitud de conexión fue aceptada.",
        deduplicationKey: `connection.accepted:${connection.id}:${connection.requesterId}`,
        metadata: { kind: "CONNECTION_ACCEPTED", connectionId: connection.id },
      },
      transaction,
    );
  }

  async withdrawConnection(
    connectionId: string,
    userId: string,
  ): Promise<{ deleted: true }> {
    const result = await this.repository.revokeConnection(connectionId, userId);
    if (!result)
      throw new NotFoundException("Solicitud o conexión no encontrada.");
    for (const conversationId of result.conversationIds) {
      this.chatEvents.emitConversationRevoked(conversationId, userId);
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
      this.chatEvents.emitConversationRevoked(conversationId, blockerId);
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
    return (await this.discoveryDeckPage(viewerId, tenantId, query)).items;
  }

  async discoveryDeckPage(
    viewerId: string,
    tenantId: string,
    query: DiscoveryDeckQuery,
  ): Promise<{ items: DirectoryEntryResponse[]; nextCursor: string | null }> {
    const preferences = await this.repository.discoveryPreferences(viewerId);
    if (!preferences.configured) {
      throw new BadRequestException(
        "Configura tus preferencias de Conocer antes de recibir recomendaciones.",
      );
    }
    const includeCrossGym = await this.crossGymDiscoveryEnabled(viewerId);
    const context = discoveryCursorContext({
      viewerId,
      tenantId,
      preferences,
      includeCrossGym,
      filters: {
        objetivo: query.objetivo ?? null,
        sucursalId: query.sucursalId ?? null,
        genero: query.genero ?? null,
        q: query.q ?? null,
        limit: query.limit,
      },
    });
    let rankingCursor: string | null = null;
    let pendingIds: string[] = [];
    if (query.cursor) {
      try {
        ({ rankingCursor, pendingIds } = readDiscoveryCursor(
          query.cursor,
          context,
        ));
      } catch {
        throw new BadRequestException(
          "El cursor de Conocer ya no es válido. Reinicia la baraja.",
        );
      }
    }
    const filters = {
      objetivo: query.objetivo,
      branchId: query.sucursalId,
      gender: query.genero,
      genders: preferences.genders,
      minAge: preferences.minAge,
      maxAge: preferences.maxAge,
      search: query.q,
      limit: this.recommendations ? 150 : query.limit,
      excludeDecided: true,
      discoveryOnly: true,
      includeCrossGym,
      orderBy: "points" as const,
    };
    const rows = await this.repository.directory(
      viewerId,
      tenantId,
      env.DEFAULT_TENANT_ID,
      filters,
    );
    if (!this.recommendations || (rows.length < 2 && !query.cursor)) {
      if (query.cursor)
        throw new BadRequestException(
          "El cursor de Conocer ya no es válido. Reinicia la baraja.",
        );
      return {
        items: await this.localDiscoveryDeck(viewerId, tenantId, query),
        nextCursor: null,
      };
    }
    const viewer = await this.repository.discoveryViewerContext(viewerId);
    if (!viewer) {
      if (query.cursor)
        throw new BadRequestException(
          "El cursor de Conocer ya no es válido. Reinicia la baraja.",
        );
      return {
        items: await this.localDiscoveryDeck(viewerId, tenantId, query),
        nextCursor: null,
      };
    }
    const items: DirectoryEntryResponse[] = [];
    const servedIds = new Set<string>();
    const initiallyAuthorized = new Set(rows.map((row) => row.userId));
    const issueContinuation = (
      nextCursor: string | null,
      remainingIds: string[],
    ): string => {
      try {
        return issueDiscoveryCursor(nextCursor, context, remainingIds);
      } catch {
        throw new BadGatewayException(
          "El recomendador devolvió una continuación demasiado grande.",
        );
      }
    };
    let cursor = rankingCursor;
    let pending = pendingIds;
    for (let page = 0; page < 150 && items.length < query.limit; page += 1) {
      let rankedIds: string[];
      let fromPending = false;
      if (pending.length) {
        fromPending = true;
        rankedIds = pending;
        pending = [];
      } else {
        const ranked = await this.recommendations.rankPeople({
          version: 1,
          requestId: randomUUID(),
          preferenceVersion: preferences.version,
          limit: query.limit - items.length,
          candidates: rows.flatMap((row) => {
            if (
              !Number.isInteger(row.age) ||
              (row.age as number) < 18 ||
              !row.recommendationArea ||
              (row.gender !== "MALE" && row.gender !== "FEMALE")
            )
              return [];
            return [
              {
                id: row.userId,
                active: true,
                complete: true,
                suspended: false,
                age: row.age as number,
                gender: row.gender === "MALE" ? "MAN" : "WOMAN",
                intents: row.recommendationIntents ?? [],
                interests: recommendationFeatureCodes(
                  row.objetivo,
                  row.recommendationIntents,
                ),
                goals: row.objetivo ? [row.objetivo] : [],
                availability: [],
                area: row.recommendationArea,
              },
            ];
          }),
          seenIds: [],
          cursor: cursor ?? undefined,
          filterContext: {
            objetivo: query.objetivo,
            sucursalId: query.sucursalId,
            genero: query.genero,
            q: query.q,
            tenantId,
          },
          viewer: {
            id: viewerId,
            age: viewer.age,
            gender: viewer.gender,
            intents: preferences.intents,
            interests: [],
            goals: viewer.goal ? [viewer.goal] : [],
            availability: [],
            area: viewer.area,
            preferences: {
              genders: preferences.genders.map((gender) =>
                gender === "MALE" ? "MAN" : "WOMAN",
              ),
              minAge: preferences.minAge,
              maxAge: preferences.maxAge,
              radiusKm: preferences.radiusKm,
              flexibleAge: preferences.flexibleAge,
              flexibleDistance: preferences.flexibleDistance,
            },
          },
        });
        if (!ranked) {
          if (query.cursor || cursor)
            throw new BadRequestException(
              "El cursor de Conocer ya no es válido. Reinicia la baraja.",
            );
          return {
            items: await this.localDiscoveryDeck(viewerId, tenantId, query),
            nextCursor: null,
          };
        }
        if (
          ranked.nextCursor !== null &&
          ranked.nextCursor !== undefined &&
          (typeof ranked.nextCursor !== "string" ||
            !ranked.nextCursor ||
            ranked.nextCursor.length > 8_000)
        ) {
          throw new BadRequestException(
            "El recomendador devolvió un cursor inválido.",
          );
        }
        if (ranked.nextCursor && ranked.nextCursor === cursor) {
          throw new BadRequestException(
            "El recomendador devolvió un cursor inválido.",
          );
        }
        cursor = ranked.nextCursor ?? null;
        rankedIds = [
          ...new Set(ranked.candidates.map((candidate) => candidate.profileId)),
        ];
      }
      const beforePreferences =
        await this.repository.discoveryPreferences(viewerId);
      const beforeConsent = await this.crossGymDiscoveryEnabled(viewerId);
      if (
        !beforePreferences.configured ||
        beforePreferences.version !== preferences.version ||
        beforeConsent !== includeCrossGym
      ) {
        if (query.cursor)
          throw new BadRequestException(
            "El cursor de Conocer ya no es válido. Reinicia la baraja.",
          );
        if (!beforePreferences.configured)
          return { items: [], nextCursor: null };
        return {
          items: await this.localDiscoveryDeck(viewerId, tenantId, query),
          nextCursor: null,
        };
      }
      rankedIds = rankedIds.filter(
        (id) =>
          (fromPending || initiallyAuthorized.has(id)) && !servedIds.has(id),
      );
      const current = rankedIds.length
        ? await this.repository.directory(
            viewerId,
            tenantId,
            env.DEFAULT_TENANT_ID,
            {
              ...filters,
              userIds: rankedIds,
            },
          )
        : [];
      const afterPreferences =
        await this.repository.discoveryPreferences(viewerId);
      const afterConsent = await this.crossGymDiscoveryEnabled(viewerId);
      if (
        !afterPreferences.configured ||
        afterPreferences.version !== preferences.version ||
        afterConsent !== includeCrossGym
      ) {
        if (query.cursor)
          throw new BadRequestException(
            "El cursor de Conocer ya no es válido. Reinicia la baraja.",
          );
        if (!afterPreferences.configured)
          return { items: [], nextCursor: null };
        return {
          items: await this.localDiscoveryDeck(viewerId, tenantId, query),
          nextCursor: null,
        };
      }
      const byId = new Map(current.map((row) => [row.userId, row]));
      const validatedRows = rankedIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
      const available = query.limit - items.length;
      const pageRows = validatedRows.slice(0, available);
      const pageItems = await this.issueDiscoveryImpressions(
        viewerId,
        pageRows,
      );
      for (const item of pageItems) {
        items.push(item);
        servedIds.add(item.userId);
      }
      pending = validatedRows.slice(available).map((row) => row.userId);
      if (items.length >= query.limit) {
        return {
          items,
          nextCursor:
            pending.length || cursor
              ? issueContinuation(cursor, pending)
              : null,
        };
      }
      if (!cursor && !pending.length) return { items, nextCursor: null };
    }
    return {
      items,
      nextCursor:
        pending.length || cursor ? issueContinuation(cursor, pending) : null,
    };
  }

  private async localDiscoveryDeck(
    viewerId: string,
    tenantId: string,
    query: DiscoveryDeckQuery,
  ): Promise<DirectoryEntryResponse[]> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const preferences = await this.repository.discoveryPreferences(viewerId);
      if (!preferences.configured) return [];
      const includeCrossGym = await this.crossGymDiscoveryEnabled(viewerId);
      const rows = await this.repository.directory(
        viewerId,
        tenantId,
        env.DEFAULT_TENANT_ID,
        {
          objetivo: query.objetivo,
          branchId: query.sucursalId,
          gender: query.genero,
          genders: preferences.genders,
          minAge: preferences.minAge,
          maxAge: preferences.maxAge,
          search: query.q,
          limit: query.limit,
          excludeDecided: true,
          discoveryOnly: true,
          includeCrossGym,
          orderBy: "points",
        },
      );
      const latestPreferences =
        await this.repository.discoveryPreferences(viewerId);
      const latestConsent = await this.crossGymDiscoveryEnabled(viewerId);
      if (!latestPreferences.configured) return [];
      if (
        latestPreferences.version === preferences.version &&
        latestConsent === includeCrossGym
      ) {
        return this.issueDiscoveryImpressions(
          viewerId,
          rows.slice(0, query.limit),
        );
      }
    }
    throw new ConflictException(
      "Las preferencias cambiaron durante la consulta. Reinicia la baraja.",
    );
  }

  private async issueDiscoveryImpressions(
    viewerId: string,
    rows: readonly DirectoryRow[],
  ): Promise<DirectoryEntryResponse[]> {
    const entries = rows.map(mapDirectoryRowToResponse);
    const issued = rows.map((row) => ({
      id: randomUUID(),
      targetId: row.userId,
      featureCodes: recommendationFeatureCodes(
        row.objetivo,
        row.recommendationIntents,
      ),
    }));
    if (
      issued.length &&
      typeof this.repository.issueDiscoveryImpressions === "function"
    ) {
      await this.repository.issueDiscoveryImpressions(viewerId, issued);
    } else {
      return entries;
    }
    return entries.map((entry, index) => ({
      ...entry,
      impressionId: issued[index].id,
    }));
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
   * Un swipe sobre una carta de la baraja.
   *
   * «Me gusta» no inventa un modelo nuevo: es la solicitud de conexión de
   * siempre, y `sendConnection` ya acepta sola la que venía de vuelta — eso,
   * exactamente, es el match.
   */
  async swipe(
    viewerId: string,
    tenantId: string,
    input: SwipeInput,
  ): Promise<SwipeResponse> {
    if (viewerId === input.targetId) {
      throw new BadRequestException("No puedes hacer swipe sobre ti mismo.");
    }
    const target = await this.requireSocialCandidate(
      viewerId,
      input.targetId,
      tenantId,
    );

    try {
      return await this.repository.runInTransaction<SwipeResponse>(
        async (transaction) => {
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
            throw new ConflictException(
              "La impresión expiró o ya fue utilizada.",
            );
          }
          if (input.direction === "PASS") {
            await this.repository.createPass(viewerId, target.id, transaction);
            if (input.impressionId && featureCodes?.length) {
              await this.repository.enqueueRecommendationSignal(
                {
                  viewerId,
                  profileId: target.id,
                  impressionId: input.impressionId,
                  kind: "PASS",
                  featureCodes,
                },
                transaction,
              );
            }
            return {
              direction: "PASS",
              targetId: target.id,
              matched: false,
              connectionId: null,
            };
          }

          // Si antes lo había descartado, el descarte deja de valer: sin borrarlo,
          // deshacer este «me gusta» devolvería la carta a un limbo —sin conexión
          // pero invisible en la baraja— del que no habría forma de sacarla.
          await this.repository.deletePass(viewerId, target.id, transaction);
          const connection = await this.sendConnection(
            viewerId,
            tenantId,
            target.id,
            transaction,
          );
          if (input.impressionId && featureCodes?.length) {
            await this.repository.enqueueRecommendationSignal(
              {
                viewerId,
                profileId: target.id,
                impressionId: input.impressionId,
                kind: "LIKE",
                featureCodes,
              },
              transaction,
            );
            if (connection.status === ConnectionStatus.ACCEPTED) {
              await this.repository.enqueueRecommendationSignal(
                {
                  viewerId,
                  profileId: target.id,
                  impressionId: input.impressionId,
                  kind: "MUTUAL",
                  featureCodes,
                },
                transaction,
              );
            }
          }
          return {
            direction: "LIKE",
            targetId: target.id,
            matched: connection.status === ConnectionStatus.ACCEPTED,
            connectionId: connection.id,
          };
        },
      );
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

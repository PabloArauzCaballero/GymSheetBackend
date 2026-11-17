import {
  BadRequestException,
  ConflictException,
  HttpStatus,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";
import {
  discoveryCursorContext,
  issueDiscoveryCursor,
  readDiscoveryCursor,
} from "./discovery-deck.cursor";
import {
  decodeLocalDeckState,
  encodeLocalDeckState,
  isLocalDeckState,
  type LocalDeckState,
} from "./discovery-ranking.compose";
import {
  RankingSnapshotExpiredError,
  type DiscoveryRankingService,
} from "./discovery-ranking.service";
import { remoteDeckPage, type DeckPage } from "./discovery-remote-deck";
import type { RecommendationsClient } from "./recommendations-client";
import { recommendationFeatureCodes } from "./recommendation-feature-codes";
import { mapDiscoveryCard, type DiscoveryCardResponse } from "./social.mapper";
import type {
  DirectoryFilters,
  DirectoryRow,
  DiscoveryPreferences,
  SocialRepository,
} from "./social.repository";
import type { DiscoveryDeckQuery } from "./social.schemas";

type CardRanking = { reasons: readonly string[]; distanceKm: number | null };

interface DeckDependencies {
  repository: SocialRepository;
  recommendations?: RecommendationsClient;
  /** Absent only where a test builds `SocialService` by hand. */
  ranking?: DiscoveryRankingService;
  crossGymEnabled: (userId: string) => Promise<boolean>;
}

interface DeckRequest {
  viewerId: string;
  tenantId: string;
  query: DiscoveryDeckQuery;
  preferences: DiscoveryPreferences;
  includeCrossGym: boolean;
  context: string;
}

const invalidCursor = () =>
  new BadRequestException("El cursor de Conocer ya no es válido. Reinicia la baraja.");

/**
 * The "Conocer" deck. The local ranking (`DiscoveryRankingService`) is the
 * default and the fallback; an external ranker, when configured, may reorder
 * the same locally authorized candidates.
 */
export class DiscoveryDeckFlow {
  constructor(private readonly deps: DeckDependencies) {}

  async page(viewerId: string, tenantId: string, query: DiscoveryDeckQuery): Promise<DeckPage> {
    const { repository, recommendations, ranking } = this.deps;
    // Without saved preferences nobody is recommended: who someone wants to
    // meet (gender, age, distance) is never guessed. Stable code for clients.
    const preferences = await repository.discoveryPreferences(viewerId);
    if (!preferences.configured) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        "DISCOVERY_PREFERENCES_REQUIRED",
        "Configura tus preferencias de Conocer antes de recibir recomendaciones.",
      );
    }
    const includeCrossGym = await this.deps.crossGymEnabled(viewerId);
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
        ({ rankingCursor, pendingIds } = readDiscoveryCursor(query.cursor, context));
      } catch {
        throw invalidCursor();
      }
    }
    const request: DeckRequest = { viewerId, tenantId, query, preferences, includeCrossGym, context };
    if (ranking && (!recommendations || isLocalDeckState(rankingCursor))) {
      return this.localRankedPage(ranking, request, rankingCursor);
    }
    const filters: DirectoryFilters = {
      objetivo: query.objetivo,
      branchId: query.sucursalId,
      gender: query.genero,
      genders: preferences.genders,
      minAge: preferences.minAge,
      maxAge: preferences.maxAge,
      search: query.q,
      limit: recommendations ? 150 : query.limit,
      excludeDecided: true,
      discoveryOnly: true,
      includeCrossGym,
    };
    const pool = ranking ? await ranking.candidatePool(this.rankingInput(request), 150) : null;
    const poolRanking = new Map<string, CardRanking>(pool?.map((row) => [row.id, row]) ?? []);
    const rows = await repository.directory(
      viewerId,
      tenantId,
      env.DEFAULT_TENANT_ID,
      pool ? { ...filters, userIds: pool.map((row) => row.id) } : filters,
    );
    // Reachable only without a wired ranker (hand-built services in tests);
    // keeps the original read-then-recheck sequence of the unranked deck.
    if (!recommendations) {
      if (query.cursor) throw invalidCursor();
      return { items: await this.unrankedDeck(viewerId, tenantId, query), nextCursor: null };
    }
    return remoteDeckPage({
      ...request,
      rankingCursor,
      pendingIds,
      filters,
      rows,
      repository,
      recommendations,
      crossGymEnabled: this.deps.crossGymEnabled,
      issue: (pageRows) => this.issue(viewerId, pageRows, poolRanking, null),
      fallback: async () =>
        ranking
          ? this.localRankedPage(ranking, request, null)
          : { items: await this.unrankedDeck(viewerId, tenantId, query), nextCursor: null },
    });
  }

  private rankingInput(request: DeckRequest) {
    const { query } = request;
    return {
      viewerId: request.viewerId,
      tenantId: request.tenantId,
      includeCrossGym: request.includeCrossGym,
      preferences: request.preferences,
      filters: { objetivo: query.objetivo, branchId: query.sucursalId, gender: query.genero, search: query.q },
    };
  }

  private async localRankedPage(
    ranking: DiscoveryRankingService,
    request: DeckRequest,
    rankingCursor: string | null,
  ): Promise<DeckPage> {
    const { viewerId, tenantId, query, preferences, includeCrossGym } = request;
    let state: LocalDeckState | null = null;
    if (rankingCursor) {
      try {
        state = decodeLocalDeckState(rankingCursor);
      } catch {
        throw invalidCursor();
      }
    }
    let ranked;
    try {
      ranked = await ranking.page(this.rankingInput(request), query.limit, state);
    } catch (error) {
      if (error instanceof RankingSnapshotExpiredError) throw invalidCursor();
      throw error;
    }
    const ids = ranked.cards.map((card) => card.candidate.id);
    const rows = ids.length
      ? await this.deps.repository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
          userIds: ids,
          limit: ids.length,
          discoveryOnly: true,
          includeCrossGym,
        })
      : [];
    // Same guard as the unranked deck: preferences or consent changed while
    // ranking means this page answers a question nobody is asking any more.
    const latest = await this.deps.repository.discoveryPreferences(viewerId);
    const latestConsent = await this.deps.crossGymEnabled(viewerId);
    if (!latest.configured) return { items: [], nextCursor: null };
    if (latest.version !== preferences.version || latestConsent !== includeCrossGym) {
      throw new ConflictException("Las preferencias cambiaron durante la consulta. Reinicia la baraja.");
    }
    const byId = new Map(rows.map((row) => [row.userId, row]));
    const served = ranked.cards.flatMap((card) => {
      const row = byId.get(card.candidate.id);
      return row ? [{ row, position: card.position }] : [];
    });
    const items = await this.issue(
      viewerId,
      served.map((entry) => entry.row),
      new Map(ranked.cards.map((card) => [card.candidate.id, card.candidate])),
      { version: ranked.version, positions: served.map((entry) => entry.position) },
    );
    return {
      items,
      nextCursor: ranked.next ? issueDiscoveryCursor(encodeLocalDeckState(ranked.next), request.context) : null,
      rankingVersion: ranked.version,
    };
  }

  /** Used only when no ranker is wired (hand-built services in tests). */
  private async unrankedDeck(
    viewerId: string,
    tenantId: string,
    query: DiscoveryDeckQuery,
  ): Promise<DiscoveryCardResponse[]> {
    const { repository } = this.deps;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const preferences = await repository.discoveryPreferences(viewerId);
      if (!preferences.configured) return [];
      const includeCrossGym = await this.deps.crossGymEnabled(viewerId);
      const rows = await repository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
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
      });
      const latestPreferences = await repository.discoveryPreferences(viewerId);
      const latestConsent = await this.deps.crossGymEnabled(viewerId);
      if (!latestPreferences.configured) return [];
      if (latestPreferences.version === preferences.version && latestConsent === includeCrossGym) {
        return this.issue(viewerId, rows.slice(0, query.limit), new Map(), null);
      }
    }
    throw new ConflictException("Las preferencias cambiaron durante la consulta. Reinicia la baraja.");
  }

  /** Issues one impression per served card (recorded on display, F5.09). */
  private async issue(
    viewerId: string,
    rows: readonly DirectoryRow[],
    rankingById: ReadonlyMap<string, CardRanking>,
    placement: { version: string; positions: number[] } | null,
  ): Promise<DiscoveryCardResponse[]> {
    const entries = rows.map((row) => mapDiscoveryCard(row, rankingById.get(row.userId)));
    const issued = rows.map((row, index) => ({
      id: randomUUID(),
      targetId: row.userId,
      featureCodes: recommendationFeatureCodes(row.objetivo, row.recommendationIntents),
      rankingVersion: placement?.version ?? null,
      rankingPosition: placement?.positions[index] ?? null,
    }));
    if (!issued.length || typeof this.deps.repository.issueDiscoveryImpressions !== "function") {
      return entries;
    }
    await this.deps.repository.issueDiscoveryImpressions(viewerId, issued);
    return entries.map((entry, index) => ({ ...entry, impressionId: issued[index].id }));
  }
}

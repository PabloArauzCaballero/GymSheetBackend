import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { issueDiscoveryCursor } from "./discovery-deck.cursor";
import { isLocalDeckState } from "./discovery-ranking.compose";
import type { RecommendationsClient } from "./recommendations-client";
import { recommendationFeatureCodes } from "./recommendation-feature-codes";
import type { DiscoveryCardResponse } from "./social.mapper";
import type {
  DirectoryFilters,
  DirectoryRow,
  DiscoveryPreferences,
  SocialRepository,
} from "./social.repository";
import type { DiscoveryDeckQuery } from "./social.schemas";

export interface DeckPage {
  items: DiscoveryCardResponse[];
  nextCursor: string | null;
  rankingVersion?: string;
}

/** What the optional external ranker path needs from the deck flow. */
export interface RemoteDeckContext {
  viewerId: string;
  tenantId: string;
  query: DiscoveryDeckQuery;
  preferences: DiscoveryPreferences;
  includeCrossGym: boolean;
  context: string;
  rankingCursor: string | null;
  pendingIds: string[];
  filters: DirectoryFilters;
  /** Candidates offered to the ranker, already hard-filtered and authorized. */
  rows: DirectoryRow[];
  repository: SocialRepository;
  recommendations: RecommendationsClient;
  crossGymEnabled: (userId: string) => Promise<boolean>;
  issue: (rows: readonly DirectoryRow[]) => Promise<DiscoveryCardResponse[]>;
  /** Local deck used whenever the external ranker cannot answer. */
  fallback: () => Promise<DeckPage>;
}

const invalidCursor = () =>
  new BadRequestException("El cursor de Conocer ya no es válido. Reinicia la baraja.");

/**
 * Optional override: when `RECOMMENDATIONS_URL` is configured, an external
 * service orders the candidates the backend already authorized. Every id it
 * returns is re-validated against the current authorization before serving.
 */
export async function remoteDeckPage(ctx: RemoteDeckContext): Promise<DeckPage> {
  const { viewerId, tenantId, query, preferences, includeCrossGym, repository } = ctx;
  if (ctx.rows.length < 2 && !query.cursor) return ctx.fallback();
  const viewer = await repository.discoveryViewerContext(viewerId);
  if (!viewer) {
    if (query.cursor) throw invalidCursor();
    return ctx.fallback();
  }
  const items: DiscoveryCardResponse[] = [];
  const servedIds = new Set<string>();
  const initiallyAuthorized = new Set(ctx.rows.map((row) => row.userId));
  const issueContinuation = (nextCursor: string | null, remainingIds: string[]): string => {
    try {
      return issueDiscoveryCursor(nextCursor, ctx.context, remainingIds);
    } catch {
      throw new BadGatewayException("El recomendador devolvió una continuación demasiado grande.");
    }
  };
  const preferencesUnchanged = async (): Promise<DeckPage | null> => {
    const latest = await repository.discoveryPreferences(viewerId);
    const consent = await ctx.crossGymEnabled(viewerId);
    if (latest.configured && latest.version === preferences.version && consent === includeCrossGym) return null;
    if (query.cursor) throw invalidCursor();
    if (!latest.configured) return { items: [], nextCursor: null };
    return ctx.fallback();
  };
  let cursor = ctx.rankingCursor;
  let pending = ctx.pendingIds;
  for (let page = 0; page < 150 && items.length < query.limit; page += 1) {
    let rankedIds: string[];
    let fromPending = false;
    if (pending.length) {
      fromPending = true;
      rankedIds = pending;
      pending = [];
    } else {
      const ranked = await ctx.recommendations.rankPeople({
        version: 1,
        requestId: randomUUID(),
        preferenceVersion: preferences.version,
        limit: query.limit - items.length,
        candidates: ctx.rows.flatMap((row) => {
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
              interests: recommendationFeatureCodes(row.objetivo, row.recommendationIntents),
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
            genders: preferences.genders.map((gender) => (gender === "MALE" ? "MAN" : "WOMAN")),
            minAge: preferences.minAge,
            maxAge: preferences.maxAge,
            radiusKm: preferences.radiusKm,
            flexibleAge: preferences.flexibleAge,
            flexibleDistance: preferences.flexibleDistance,
          },
        },
      });
      if (!ranked) {
        if (query.cursor || cursor) throw invalidCursor();
        return ctx.fallback();
      }
      const next = ranked.nextCursor;
      if (
        next !== null &&
        next !== undefined &&
        (typeof next !== "string" || !next || next.length > 8_000 || isLocalDeckState(next))
      ) {
        throw new BadRequestException("El recomendador devolvió un cursor inválido.");
      }
      if (next && next === cursor) {
        throw new BadRequestException("El recomendador devolvió un cursor inválido.");
      }
      cursor = next ?? null;
      rankedIds = [...new Set(ranked.candidates.map((candidate) => candidate.profileId))];
    }
    const changedBefore = await preferencesUnchanged();
    if (changedBefore) return changedBefore;
    rankedIds = rankedIds.filter(
      (id) => (fromPending || initiallyAuthorized.has(id)) && !servedIds.has(id),
    );
    const current = rankedIds.length
      ? await repository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
          ...ctx.filters,
          userIds: rankedIds,
        })
      : [];
    const changedAfter = await preferencesUnchanged();
    if (changedAfter) return changedAfter;
    const byId = new Map(current.map((row) => [row.userId, row]));
    const validatedRows = rankedIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    const available = query.limit - items.length;
    const pageItems = await ctx.issue(validatedRows.slice(0, available));
    for (const item of pageItems) {
      items.push(item);
      servedIds.add(item.userId);
    }
    pending = validatedRows.slice(available).map((row) => row.userId);
    if (items.length >= query.limit) {
      return {
        items,
        nextCursor: pending.length || cursor ? issueContinuation(cursor, pending) : null,
      };
    }
    if (!cursor && !pending.length) return { items, nextCursor: null };
  }
  return {
    items,
    nextCursor: pending.length || cursor ? issueContinuation(cursor, pending) : null,
  };
}

import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { env } from "../../config/env";

export interface PeopleRankRequest {
  version: 1;
  requestId: string;
  preferenceVersion: number;
  limit: number;
  candidates: {
    id: string; active: boolean; complete: boolean; suspended: boolean; age: number;
    gender: string; intents: string[]; interests: string[]; goals: string[]; availability: string[];
    area: { lat: number; lon: number };
  }[];
  seenIds: string[];
  cursor?: string;
  filterContext?: { objetivo?: string; sucursalId?: string; genero?: "MALE" | "FEMALE"; q?: string; tenantId: string };
  viewer: {
    id: string;
    age: number;
    gender: string;
    intents: string[];
    interests: string[];
    goals: string[];
    availability: string[];
    area: { lat: number; lon: number };
    preferences: {
      genders: ("MAN" | "WOMAN")[];
      minAge: number;
      maxAge: number;
      radiusKm: number;
      flexibleAge: boolean;
      flexibleDistance: boolean;
    };
  };
}

export interface PeopleRankResponse {
  requestId: string;
  preferenceVersion: number;
  candidates: { profileId: string; score: number; reasonCodes: string[] }[];
  nextCursor?: string | null;
}

export interface SocialRecommendationEvent {
  eventId: string;
  aggregateId: string;
  aggregateVersion: number;
  schemaVersion: 1;
  type: "social.profile.updated" | "social.profile.deleted";
  payload: Record<string, unknown>;
}

/** Optional ranking transport. `null` means the local authorized ordering remains in use. */
@Injectable()
export class RecommendationsClient {
  private configuration(config: { baseUrl?: string; serviceToken?: string }) {
    return {
      baseUrl: config.baseUrl ?? env.RECOMMENDATIONS_URL,
      serviceToken: config.serviceToken ?? env.RECOMMENDATIONS_SERVICE_TOKEN,
    };
  }

  async rankPeople(
    request: PeopleRankRequest,
    config: { baseUrl?: string; serviceToken?: string } = {},
    fetcher: typeof fetch = fetch,
  ): Promise<PeopleRankResponse | null> {
    const { baseUrl, serviceToken } = this.configuration(config);
    if (!baseUrl || !serviceToken) return null;
    try {
      const response = await fetcher(`${baseUrl.replace(/\/$/u, "")}/v1/rank/people`, {
        method: "POST",
        headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ...request, filterContext: request.filterContext && {
          goal: request.filterContext.objetivo,
          branchId: request.filterContext.sucursalId,
          gender: request.filterContext.genero,
          search: request.filterContext.q,
          tenantId: request.filterContext.tenantId,
        } }),
        signal: AbortSignal.timeout(300),
      });
      if (!response.ok) {
        if (response.status === 422 && request.cursor) throw new UnprocessableEntityException("El cursor de Conocer ya no es válido. Reinicia la baraja.");
        return null;
      }
      const value = await response.json() as Partial<PeopleRankResponse>;
      if (value.requestId !== request.requestId || value.preferenceVersion !== request.preferenceVersion ||
          !Array.isArray(value.candidates) || value.candidates.some((candidate) =>
            !candidate || typeof candidate.profileId !== "string" || !Number.isFinite(candidate.score) || !Array.isArray(candidate.reasonCodes))) return null;
      return value as PeopleRankResponse;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      return null;
    }
  }

  async consumeEvents(
    events: readonly SocialRecommendationEvent[],
    config: { baseUrl?: string; serviceToken?: string } = {},
    fetcher: typeof fetch = fetch,
  ): Promise<boolean> {
    const { baseUrl, serviceToken } = this.configuration(config);
    if (!baseUrl || !serviceToken) return false;
    try {
      const response = await fetcher(`${baseUrl.replace(/\/$/u, "")}/v1/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
        body: JSON.stringify({ version: 1, events }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const value = await response.json() as { results?: unknown };
      return Array.isArray(value.results) && value.results.length === events.length &&
        value.results.every((entry) => entry && typeof entry === "object" &&
          ["APPLIED", "DUPLICATE", "STALE", "IGNORED"].includes((entry as { status?: string }).status ?? ""));
    } catch {
      return false;
    }
  }
}

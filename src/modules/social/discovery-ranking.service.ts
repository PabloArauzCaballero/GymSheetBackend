import { Injectable, Logger, Optional } from "@nestjs/common";
import { CounterRegistry } from "../../common/metrics/counter-registry";
import {
  assignRankingConfig,
  DEFAULT_RANKING_CONFIG,
  explorationInterval,
  type RankingConfig,
} from "./discovery-ranking.config";
import {
  composeDeckPage,
  type LocalDeckState,
} from "./discovery-ranking.compose";
import {
  DiscoveryRankingRepository,
  type RankedCandidate,
  type RankingQuery,
} from "./discovery-ranking.repository";

const CONFIG_TTL_MS = 60_000;
const LIKE_RATE_TTL_MS = 10 * 60_000;
/** Prior used until the platform has its own decisions. */
const DEFAULT_GLOBAL_LIKE_RATE = 0.3;

export type RankingInput = Omit<
  RankingQuery,
  "config" | "asOf" | "globalLikeRate" | "rowLimit" | "key" | "forcedIds" | "excludedIds"
>;

export interface RankedPage {
  cards: { candidate: RankedCandidate; position: number }[];
  next: LocalDeckState | null;
  version: string;
}

/** Thrown when a cursor names a ranking version that is no longer active. */
export class RankingSnapshotExpiredError extends Error {
  constructor() {
    super("RANKING_SNAPSHOT_EXPIRED");
  }
}

function positionBucket(position: number | null): string {
  if (position === null) return "unknown";
  if (position <= 3) return "1-3";
  if (position <= 6) return "4-6";
  if (position <= 10) return "7-10";
  return "11+";
}

/**
 * Local ranking of the "Conocer" deck: A/B config assignment, the single SQL
 * ranking, page composition and its metrics (served cards, likes, passes,
 * matches and match position per config version).
 */
@Injectable()
export class DiscoveryRankingService {
  private readonly logger = new Logger(DiscoveryRankingService.name);
  private configs: { value: RankingConfig[]; expiresAt: number } | null = null;
  private likeRate: { value: number; expiresAt: number } | null = null;

  constructor(
    private readonly repository: DiscoveryRankingRepository,
    @Optional() private readonly counters?: CounterRegistry,
  ) {}

  async configFor(viewerId: string, version?: string): Promise<RankingConfig> {
    const now = Date.now();
    if (!this.configs || this.configs.expiresAt <= now) {
      this.configs = { value: await this.repository.activeConfigs(), expiresAt: now + CONFIG_TTL_MS };
    }
    const configs = this.configs.value.length ? this.configs.value : [DEFAULT_RANKING_CONFIG];
    if (version === undefined) return assignRankingConfig(viewerId, configs);
    const pinned = configs.find((config) => config.version === version);
    if (!pinned) throw new RankingSnapshotExpiredError();
    return pinned;
  }

  private async globalLikeRate(): Promise<number> {
    const now = Date.now();
    if (!this.likeRate || this.likeRate.expiresAt <= now) {
      const measured = await this.repository.globalLikeRate();
      this.likeRate = { value: measured ?? DEFAULT_GLOBAL_LIKE_RATE, expiresAt: now + LIKE_RATE_TTL_MS };
    }
    return this.likeRate.value;
  }

  /** One deck page; `state` is null for a fresh snapshot. */
  async page(input: RankingInput, limit: number, state: LocalDeckState | null): Promise<RankedPage> {
    const config = await this.configFor(input.viewerId, state?.version);
    const current: LocalDeckState = state ?? {
      asOf: Date.now(),
      version: config.version,
      position: 0,
      key: null,
      pendingLiked: [],
      servedAhead: [],
    };
    const rows = await this.repository.rank({
      ...input,
      config,
      asOf: new Date(current.asOf),
      globalLikeRate: await this.globalLikeRate(),
      rowLimit: limit + 10,
      key: current.key,
      forcedIds: current.pendingLiked,
      excludedIds: current.servedAhead,
    });
    const composed = composeDeckPage(rows, current, limit, explorationInterval(config.explorationShare));
    this.recordServed(config.version, composed.cards.length);
    return { ...composed, version: config.version };
  }

  /** Locally ranked, hard-filtered candidates for the optional external ranker. */
  async candidatePool(input: RankingInput, size: number): Promise<RankedCandidate[]> {
    const config = await this.configFor(input.viewerId);
    const rows = await this.repository.rank({
      ...input,
      config,
      asOf: new Date(),
      globalLikeRate: await this.globalLikeRate(),
      rowLimit: size,
      key: null,
      forcedIds: [],
      excludedIds: [],
    });
    return rows.slice(0, size);
  }

  private recordServed(version: string, count: number): void {
    this.counters?.increment(
      "discovery_cards_served_total",
      "Discovery cards served, by ranking config.",
      { config: version },
      count,
    );
    this.logger.debug({ event: "discovery.deck.served", configVersion: version, cards: count });
  }

  /**
   * Like/pass/match metrics, attributed to the config version and position of
   * the card when an impression exists ("none" otherwise: directory, map or
   * likes panel). Never throws: metrics must not fail a decision.
   */
  async recordDecision(input: {
    viewerId: string;
    targetId: string;
    impressionId?: string;
    direction: "LIKE" | "PASS";
    matched: boolean;
  }): Promise<void> {
    try {
      const served = await this.repository.attribution(input.viewerId, input.targetId, input.impressionId);
      const config = served?.version ?? "none";
      const position = served?.position ?? null;
      this.counters?.increment("discovery_decisions_total", "Discovery decisions, by ranking config.", {
        config,
        direction: input.direction,
      });
      if (input.matched) {
        this.counters?.increment("discovery_matches_total", "Mutual likes, by ranking config.", { config });
        this.counters?.increment("discovery_match_position_total", "Deck position of matched cards.", {
          config,
          bucket: positionBucket(position),
        });
      }
      this.logger.log({
        event: "discovery.decision.recorded",
        configVersion: config,
        direction: input.direction,
        matched: input.matched,
        position,
      });
    } catch (error) {
      this.logger.warn({
        event: "discovery.decision.metrics_failed",
        reason: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
import {
  rankingConfigFromRow,
  type RankingConfig,
  type RankingConfigRow,
} from "./discovery-ranking.config";
import { DISCOVERY_RANKING_SQL } from "./discovery-ranking.sql";
import type { DiscoveryPreferences } from "./social.repository";

/** One scored candidate, in deck order. Factors are exposed for tests and audits. */
export interface RankedCandidate {
  id: string;
  likedViewer: boolean;
  isNew: boolean;
  distanceKm: number | null;
  reasons: string[];
  /** Fixed 6-decimal text: compared exactly by the keyset. */
  score: string;
  activity: number;
  mutual: number;
  distance: number;
  intent: number;
  affinity: number;
  verification: number;
  novelty: number;
}

export interface RankingQuery {
  viewerId: string;
  tenantId: string;
  includeCrossGym: boolean;
  preferences: DiscoveryPreferences;
  filters: { objetivo?: string; branchId?: string; gender?: string; search?: string };
  config: RankingConfig;
  asOf: Date;
  globalLikeRate: number;
  /** Rows after the keyset (plus every new or liked-you row, for composition). */
  rowLimit: number;
  key: { score: string; id: string } | null;
  forcedIds: readonly string[];
  excludedIds: readonly string[];
}

/** Candidate pool size read in index order before scoring. */
export const RANKING_POOL_LIMIT = 300;
/** Bayesian prior strength (pseudo-decisions) for the mutual-like rate. */
export const MUTUAL_PRIOR_WEIGHT = 10;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

@Injectable()
export class DiscoveryRankingRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async rank(query: RankingQuery): Promise<RankedCandidate[]> {
    const { preferences, config, filters } = query;
    const rows = await this.sequelize.query<
      Omit<RankedCandidate, "distanceKm"> & { distanceKm: number | string | null }
    >(DISCOVERY_RANKING_SQL, {
      type: QueryTypes.SELECT,
      replacements: {
        viewerId: query.viewerId,
        tenantId: query.tenantId,
        includeCrossGym: query.includeCrossGym,
        genders: preferences.genders,
        intents: preferences.intents,
        minAge: preferences.minAge,
        maxAge: preferences.maxAge,
        flexibleAge: preferences.flexibleAge,
        radiusKm: preferences.radiusKm,
        flexibleDistance: preferences.flexibleDistance,
        asOf: query.asOf.toISOString(),
        timeZone: env.BUSINESS_TIME_ZONE,
        objetivo: filters.objetivo ?? null,
        branchId: filters.branchId ?? null,
        gender: filters.gender ?? null,
        search: filters.search ? `%${escapeLike(filters.search)}%` : null,
        wActivity: config.weights.activity,
        wMutual: config.weights.mutual,
        wDistance: config.weights.distance,
        wIntent: config.weights.intent,
        wAffinity: config.weights.affinity,
        wVerification: config.weights.verification,
        wNovelty: config.weights.novelty,
        priorWeight: MUTUAL_PRIOR_WEIGHT,
        globalLikeRate: query.globalLikeRate,
        poolLimit: RANKING_POOL_LIMIT,
        rowLimit: query.rowLimit,
        hasKey: query.key !== null,
        keyScore: query.key?.score ?? null,
        keyId: query.key?.id ?? null,
        // Placeholders must exist even when unused: `IN ()` is not valid SQL.
        hasForced: query.forcedIds.length > 0,
        forcedIds: query.forcedIds.length ? query.forcedIds : [null],
        hasExcluded: query.excludedIds.length > 0,
        excludedIds: query.excludedIds.length ? query.excludedIds : [null],
      },
    });
    return rows.map((row) => ({
      ...row,
      distanceKm: row.distanceKm === null ? null : Number(row.distanceKm),
    }));
  }

  async activeConfigs(): Promise<RankingConfig[]> {
    const rows = await this.sequelize.query<RankingConfigRow>(
      `SELECT version, w_activity, w_mutual, w_distance, w_intent, w_affinity,
              w_verification, w_novelty, exploration_share, traffic_weight
         FROM social.ranking_config WHERE active ORDER BY version`,
      { type: QueryTypes.SELECT },
    );
    return rows.map(rankingConfigFromRow);
  }

  /**
   * Global like rate (likes / decisions over 90 days): the prior toward which
   * each candidate's own like rate is smoothed. Cached by the caller.
   */
  async globalLikeRate(): Promise<number | null> {
    const rows = await this.sequelize.query<{ likes: string; passes: string }>(
      `SELECT (SELECT count(*) FROM social.connections WHERE created_at >= now() - INTERVAL '90 days') AS likes,
              (SELECT count(*) FROM social.discovery_passes WHERE created_at >= now() - INTERVAL '90 days') AS passes`,
      { type: QueryTypes.SELECT },
    );
    const likes = Number(rows[0]?.likes ?? 0);
    const decisions = likes + Number(rows[0]?.passes ?? 0);
    return decisions > 0 ? likes / decisions : null;
  }

  /** Config version and deck position that served a card, for decision metrics. */
  async attribution(
    viewerId: string,
    targetId: string,
    impressionId: string | undefined,
  ): Promise<{ version: string | null; position: number | null } | null> {
    const rows = await this.sequelize.query<{
      ranking_version: string | null;
      ranking_position: number | null;
    }>(
      `SELECT ranking_version, ranking_position FROM social.discovery_impressions
        WHERE viewer_id = :viewerId AND target_id = :targetId
          AND (:impressionId::uuid IS NULL OR id = :impressionId)
          AND issued_at >= now() - INTERVAL '24 hours'
        ORDER BY issued_at DESC LIMIT 1`,
      {
        type: QueryTypes.SELECT,
        replacements: { viewerId, targetId, impressionId: impressionId ?? null },
      },
    );
    const row = rows[0];
    return row ? { version: row.ranking_version, position: row.ranking_position } : null;
  }
}

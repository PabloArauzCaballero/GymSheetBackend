import { createHash } from "node:crypto";

/**
 * Weights of the local "Conocer" score
 * S = wA·A + wM·M + wD·D + wI·I + wF·F + wV·V + wN·N (minus flexible-age penalty).
 *
 * Inspired by the factors Tinder describes publicly since it dropped Elo in
 * 2019: activity, being active at the same time, preferences, location and
 * the likelihood of a mutual like. There is no desirability score, gamification
 * points are not an input, and sexual orientation is never read.
 */
export interface RankingWeights {
  activity: number;
  mutual: number;
  distance: number;
  intent: number;
  affinity: number;
  verification: number;
  novelty: number;
}

export interface RankingConfig {
  version: string;
  weights: RankingWeights;
  /** Share of deck positions reserved for accounts younger than 7 days. */
  explorationShare: number;
  /** Relative traffic for A/B assignment between active versions. */
  trafficWeight: number;
}

/** Same values the migration seeds as `v1`; used when the table is empty. */
export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  version: "v1",
  weights: {
    activity: 0.25,
    mutual: 0.2,
    distance: 0.15,
    intent: 0.1,
    affinity: 0.15,
    verification: 0.1,
    novelty: 0.05,
  },
  explorationShare: 0.1,
  trafficWeight: 100,
};

export interface RankingConfigRow {
  version: string;
  w_activity: string | number;
  w_mutual: string | number;
  w_distance: string | number;
  w_intent: string | number;
  w_affinity: string | number;
  w_verification: string | number;
  w_novelty: string | number;
  exploration_share: string | number;
  traffic_weight: number;
}

/** Numeric columns arrive as text from the driver. */
export function rankingConfigFromRow(row: RankingConfigRow): RankingConfig {
  return {
    version: row.version,
    weights: {
      activity: Number(row.w_activity),
      mutual: Number(row.w_mutual),
      distance: Number(row.w_distance),
      intent: Number(row.w_intent),
      affinity: Number(row.w_affinity),
      verification: Number(row.w_verification),
      novelty: Number(row.w_novelty),
    },
    explorationShare: Number(row.exploration_share),
    trafficWeight: Number(row.traffic_weight),
  };
}

/**
 * Stable A/B assignment: the same viewer always lands on the same version while
 * the set of active versions and their traffic weights do not change.
 */
export function assignRankingConfig(
  userId: string,
  configs: readonly RankingConfig[],
): RankingConfig {
  const eligible = [...configs]
    .filter((config) => config.trafficWeight > 0)
    .sort((left, right) => left.version.localeCompare(right.version));
  const total = eligible.reduce((sum, config) => sum + config.trafficWeight, 0);
  if (!eligible.length || total <= 0) return DEFAULT_RANKING_CONFIG;
  const bucket =
    createHash("sha256").update(userId).digest().readUInt32BE(0) % total;
  let cumulative = 0;
  for (const config of eligible) {
    cumulative += config.trafficWeight;
    if (bucket < cumulative) return config;
  }
  return eligible[eligible.length - 1];
}

/** Every Nth deck position goes to exploration (10% → every 10th). 0 disables it. */
export function explorationInterval(share: number): number {
  return share > 0 ? Math.max(2, Math.round(1 / share)) : 0;
}

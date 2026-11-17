import {
  assignRankingConfig,
  DEFAULT_RANKING_CONFIG,
  explorationInterval,
  rankingConfigFromRow,
  type RankingConfig,
} from "./discovery-ranking.config";

const variant = (version: string, trafficWeight: number): RankingConfig => ({
  ...DEFAULT_RANKING_CONFIG,
  version,
  trafficWeight,
});
const userId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("ranking config", () => {
  it("weights add up to 1 by default", () => {
    const weights: number[] = Object.values(DEFAULT_RANKING_CONFIG.weights);
    const total = weights.reduce((sum: number, weight: number) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("parses numeric columns returned as text", () => {
    expect(
      rankingConfigFromRow({
        version: "v1",
        w_activity: "0.250",
        w_mutual: "0.200",
        w_distance: "0.150",
        w_intent: "0.100",
        w_affinity: "0.150",
        w_verification: "0.100",
        w_novelty: "0.050",
        exploration_share: "0.10",
        traffic_weight: 100,
      }),
    ).toEqual(DEFAULT_RANKING_CONFIG);
  });

  it("assigns each viewer to the same version every time", () => {
    const configs = [variant("v1", 50), variant("v2", 50)];
    for (let n = 0; n < 50; n += 1) {
      expect(assignRankingConfig(userId(n), configs)).toBe(assignRankingConfig(userId(n), [...configs].reverse()));
    }
  });

  it("splits traffic by weight between the active versions", () => {
    const configs = [variant("v1", 80), variant("v2", 20)];
    const counts = { v1: 0, v2: 0 };
    for (let n = 0; n < 2_000; n += 1) {
      counts[assignRankingConfig(userId(n), configs).version as "v1" | "v2"] += 1;
    }
    expect(counts.v2 / 2_000).toBeGreaterThan(0.15);
    expect(counts.v2 / 2_000).toBeLessThan(0.25);
  });

  it("falls back to the code defaults without eligible versions", () => {
    expect(assignRankingConfig(userId(1), [])).toBe(DEFAULT_RANKING_CONFIG);
    expect(assignRankingConfig(userId(1), [variant("v9", 0)])).toBe(DEFAULT_RANKING_CONFIG);
  });

  it("maps the exploration share to a position interval", () => {
    expect(explorationInterval(0.1)).toBe(10);
    expect(explorationInterval(0)).toBe(0);
  });
});

import { UserGender } from "../../common/enums/domain.enums";
import { computeStreaks } from "./progression.repository";
import type { TrainingMetrics } from "./progression.repository";
import { badgeSeeds, levelSeeds } from "./progression-catalog";
import { computePoints, measure, toAudience } from "./progression.service";

const NO_TRAINING: TrainingMetrics = {
  totalSessions: 0,
  totalSets: 0,
  totalReps: 0,
  totalVolumeKg: 0,
  maxSessionVolumeKg: 0,
  distinctExercises: 0,
  distinctMuscleGroups: 0,
  earlySessions: 0,
  nightSessions: 0,
  weekendSessions: 0,
  personalRecords: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  weeklyStreak: 0,
  lastSessionOn: null,
  firstSessionOn: null,
};

describe("computeStreaks", () => {
  it("has no streak without training days", () => {
    expect(computeStreaks([], "2026-08-23")).toEqual({
      current: 0,
      longest: 0,
      weeks: 0,
    });
  });

  it("counts consecutive days as one run", () => {
    const streaks = computeStreaks(
      ["2026-08-19", "2026-08-20", "2026-08-21"],
      "2026-08-21",
    );
    expect(streaks.current).toBe(3);
    expect(streaks.longest).toBe(3);
  });

  /**
   * Quien entrena por la tarde abre la aplicación por la mañana con la racha
   * todavía intacta. Cortarla a medianoche la haría inalcanzable para esa
   * persona, que es la mayoría.
   */
  it("keeps the streak alive the day after training", () => {
    expect(
      computeStreaks(["2026-08-21", "2026-08-22"], "2026-08-23").current,
    ).toBe(2);
  });

  it("drops the current streak after two days without training", () => {
    const streaks = computeStreaks(
      ["2026-08-19", "2026-08-20", "2026-08-21"],
      "2026-08-24",
    );
    expect(streaks.current).toBe(0);
    // La más larga es historia y no se pierde por descansar.
    expect(streaks.longest).toBe(3);
  });

  it("remembers the longest run even when a later run is shorter", () => {
    const streaks = computeStreaks(
      ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-20"],
      "2026-08-20",
    );
    expect(streaks.longest).toBe(4);
    expect(streaks.current).toBe(1);
  });

  it("ignores a repeated day", () => {
    // El día llega ya deduplicado desde SQL; esto fija esa expectativa.
    expect(computeStreaks(["2026-08-22"], "2026-08-22").current).toBe(1);
  });

  /**
   * La racha semanal es la métrica de constancia de quien entrena tres días por
   * semana: la racha diaria nunca lo premia, aunque lleve un año sin fallar.
   */
  it("counts consecutive weeks with at least one session", () => {
    const days = [
      "2026-08-04", // martes
      "2026-08-12", // miércoles siguiente
      "2026-08-17", // lunes siguiente
    ];
    expect(computeStreaks(days, "2026-08-19").weeks).toBe(3);
  });

  it("breaks the weekly streak on a skipped week", () => {
    const days = ["2026-08-04", "2026-08-18"];
    expect(computeStreaks(days, "2026-08-19").weeks).toBe(1);
  });
});

describe("computePoints", () => {
  it("gives nothing for no training", () => {
    expect(computePoints(NO_TRAINING, [])).toBe(0);
  });

  it("adds session, set, volume and streak components", () => {
    const metrics: TrainingMetrics = {
      ...NO_TRAINING,
      totalSessions: 2, // 100
      totalSets: 20, // 40
      totalVolumeKg: 5000, // 50
      longestStreakDays: 2, // 20
    };
    expect(computePoints(metrics, [])).toBe(210);
  });

  it("adds the reward of every satisfied badge", () => {
    expect(
      computePoints(NO_TRAINING, [{ pointsReward: 25 }, { pointsReward: 50 }]),
    ).toBe(75);
  });

  /**
   * Una sesión corriente debe rondar los 150 puntos: es la unidad con la que se
   * calibraron los umbrales de los rangos, y si se desvía la senda entera se
   * recoloca sin que nadie lo note.
   */
  it("keeps a typical session near the calibrated 150 points", () => {
    const oneSession: TrainingMetrics = {
      ...NO_TRAINING,
      totalSessions: 1,
      totalSets: 20,
      totalVolumeKg: 5000,
      longestStreakDays: 1,
    };
    const points = computePoints(oneSession, []);
    expect(points).toBeGreaterThanOrEqual(120);
    expect(points).toBeLessThanOrEqual(180);
  });
});

describe("measure", () => {
  it("maps every criterion in the seeded catalogue to a metric", () => {
    const metrics: TrainingMetrics = { ...NO_TRAINING, totalSessions: 7 };
    for (const badge of badgeSeeds) {
      expect(Number.isFinite(measure(metrics, badge.criterionType))).toBe(true);
    }
  });

  /**
   * La racha que cuenta para las insignias es la más larga, no la vigente: una
   * insignia conseguida no puede desaparecer por tomarse una semana libre.
   */
  it("scores streak badges on the longest run, not the current one", () => {
    const metrics: TrainingMetrics = {
      ...NO_TRAINING,
      currentStreakDays: 0,
      longestStreakDays: 30,
    };
    expect(measure(metrics, "STREAK_DAYS")).toBe(30);
  });
});

describe("toAudience", () => {
  it("routes a declared gender to its own branch", () => {
    expect(toAudience(UserGender.MALE)).toBe("MALE");
    expect(toAudience(UserGender.FEMALE)).toBe("FEMALE");
  });

  it("routes an undeclared or withheld gender to the neutral branch", () => {
    expect(toAudience(null)).toBe("ANY");
    expect(toAudience(UserGender.UNSPECIFIED)).toBe("ANY");
  });
});

describe("seeded catalogue", () => {
  it("offers a complete path for each of the three branches", () => {
    for (const audience of ["ANY", "MALE", "FEMALE"] as const) {
      const path = levelSeeds.filter((level) => level.audience === audience);
      expect(path).toHaveLength(8);
      expect(path[0].minPoints).toBe(0);
    }
  });

  /**
   * Las tres ramas comparten umbrales a propósito: si una subiera más rápido,
   * elegir género dejaría de ser identidad y pasaría a ser una ventaja.
   */
  it("asks the same effort of every branch", () => {
    const thresholdsFor = (audience: string) =>
      levelSeeds
        .filter((level) => level.audience === audience)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((level) => level.minPoints);

    expect(thresholdsFor("MALE")).toEqual(thresholdsFor("ANY"));
    expect(thresholdsFor("FEMALE")).toEqual(thresholdsFor("ANY"));
  });

  it("keeps level codes unique inside each branch", () => {
    for (const audience of ["ANY", "MALE", "FEMALE"] as const) {
      const codes = levelSeeds
        .filter((level) => level.audience === audience)
        .map((level) => level.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("keeps badge codes unique inside each branch", () => {
    for (const audience of ["ANY", "MALE", "FEMALE"] as const) {
      const codes = badgeSeeds
        .filter((badge) => badge.audience === audience)
        .map((badge) => badge.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("marks every secret badge as such in its category", () => {
    for (const badge of badgeSeeds.filter((entry) => entry.secret)) {
      expect(badge.category).toBe("SECRETA");
    }
  });

  it("reaches the first badge within the first few sessions", () => {
    const cheapest = Math.min(
      ...badgeSeeds
        .filter((badge) => badge.criterionType === "SESSION_COUNT")
        .map((badge) => badge.criterionThreshold),
    );
    expect(cheapest).toBe(1);
  });
});

import { UserGender } from "../../common/enums/domain.enums";
import { computeStreaks, countComebacks } from "./progression.repository";
import type { TrainingMetrics } from "./progression.repository";
import { badgeIllustration, rarityRank } from "./badge-illustrations";
import { badgeSeeds, levelSeeds } from "./progression-catalog";
import { extendedBadgeSeeds } from "./progression-catalog-extended";
import { coachRrssBadgeSeeds } from "./progression-catalog-coach-rrss";
import { criterionTypeSchema } from "./progression.schemas";
import { restDaysSchema } from "./progression.schemas";
import {
  computePoints,
  computePointsBreakdown,
  measure,
  toAudience,
} from "./progression.service";

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
      freezes: 0,
      freezesUsed: 0,
      freezesEarned: 0,
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

  /**
   * 2026-08-03 es lunes, 2026-08-04 es martes (ver el comentario del test de
   * semanas más arriba) y 2026-08-05 es miércoles.
   */
  describe("with declared rest weekdays", () => {
    it("bridges a gap when every skipped day is a declared rest day", () => {
      const streaks = computeStreaks(
        ["2026-08-03", "2026-08-05"], // lunes, miércoles: falta el martes
        "2026-08-05",
        new Set([2]), // martes
      );
      expect(streaks.current).toBe(2);
      expect(streaks.longest).toBe(2);
    });

    it("still breaks the streak when the skipped day is not a rest day", () => {
      const streaks = computeStreaks(
        ["2026-08-03", "2026-08-05"],
        "2026-08-05",
        new Set([3]), // miércoles: no es el día que falta
      );
      expect(streaks.current).toBe(1);
      expect(streaks.longest).toBe(1);
    });

    it("keeps the current streak alive across a rest day up to today", () => {
      // Último entrenamiento el lunes; hoy es miércoles y el martes es descanso.
      const streaks = computeStreaks(["2026-08-03"], "2026-08-05", new Set([2]));
      expect(streaks.current).toBe(1);
    });

    it("does not bridge a gap longer than the declared rest days", () => {
      // Falta el martes Y el jueves; solo el martes está declarado como descanso.
      const streaks = computeStreaks(["2026-08-03", "2026-08-06"], "2026-08-06", new Set([2]));
      expect(streaks.current).toBe(1);
      expect(streaks.longest).toBe(1);
    });
  });

  /**
   * Comodines (P3): cada 7 días de racha se gana uno, máximo dos guardados. Un
   * día que falta y no es de descanso gasta uno solo y la racha sigue. Agosto
   * de 2026 empieza en sábado; 2026-08-03 es lunes.
   */
  describe("with streak freezes", () => {
    const run = (from: string, count: number): string[] =>
      Array.from({ length: count }, (_, index) => shift(from, index));

    it("earns one freeze every seven days and keeps at most two", () => {
      expect(computeStreaks(run("2026-08-01", 6), "2026-08-06").freezes).toBe(0);
      expect(computeStreaks(run("2026-08-01", 7), "2026-08-07")).toMatchObject({
        current: 7,
        freezes: 1,
        freezesEarned: 1,
      });
      expect(computeStreaks(run("2026-08-01", 21), "2026-08-21")).toMatchObject({
        current: 21,
        freezes: 2,
        freezesEarned: 3,
      });
    });

    it("spends a freeze on a missed day and the streak goes on without counting that day", () => {
      const days = [...run("2026-08-01", 7), "2026-08-09"]; // falta el 8
      expect(computeStreaks(days, "2026-08-09")).toMatchObject({
        current: 8,
        longest: 8,
        freezes: 0,
        freezesUsed: 1,
        freezesEarned: 1,
      });
    });

    it("without a freeze the same gap breaks the streak, as before", () => {
      const days = [...run("2026-08-01", 6), "2026-08-08"]; // falta el 7
      expect(computeStreaks(days, "2026-08-08")).toMatchObject({ current: 1, longest: 6, freezes: 0 });
    });

    it("covers a two-day gap with two freezes", () => {
      const days = [...run("2026-08-01", 14), "2026-08-17"]; // faltan el 15 y el 16
      expect(computeStreaks(days, "2026-08-17")).toMatchObject({ current: 15, freezes: 0, freezesUsed: 2 });
    });

    it("breaks when the gap needs more freezes than there are, and the freezes go with the streak", () => {
      const days = [...run("2026-08-01", 14), "2026-08-18"]; // faltan tres días
      expect(computeStreaks(days, "2026-08-18")).toMatchObject({
        current: 1,
        longest: 14,
        freezes: 0,
        freezesUsed: 0,
        freezesEarned: 0,
      });
    });

    it("does not spend a freeze on a declared rest day", () => {
      // 2026-08-08 es sábado (6): descanso declarado.
      const days = [...run("2026-08-01", 7), "2026-08-09"];
      expect(computeStreaks(days, "2026-08-09", new Set([6]))).toMatchObject({
        current: 8,
        freezes: 1,
        freezesUsed: 0,
      });
    });

    it("spends freezes on the days already missed up to today, but not on today", () => {
      const days = run("2026-08-01", 7);
      expect(computeStreaks(days, "2026-08-08")).toMatchObject({ current: 7, freezes: 1, freezesUsed: 0 });
      expect(computeStreaks(days, "2026-08-09")).toMatchObject({ current: 7, freezes: 0, freezesUsed: 1 });
      expect(computeStreaks(days, "2026-08-10").current).toBe(0);
    });

    it("never shortens a streak compared with the rule without freezes (1000 random histories)", () => {
      let seed = 42;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
      for (let history = 0; history < 1000; history += 1) {
        const days: string[] = [];
        let cursor = "2026-01-05";
        for (let step = 0; step < 60; step += 1) {
          cursor = shift(cursor, random() < 0.75 ? 1 : 2 + Math.floor(random() * 3));
          days.push(cursor);
        }
        const today = shift(cursor, Math.floor(random() * 3));
        const withFreezes = computeStreaks(days, today);
        const strict = strictLongest(days);
        expect(withFreezes.longest).toBeGreaterThanOrEqual(strict);
        expect(withFreezes.freezes).toBeGreaterThanOrEqual(0);
        expect(withFreezes.freezes).toBeLessThanOrEqual(2);
      }
    });
  });
});

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** La racha más larga con la regla de antes: solo días consecutivos. */
function strictLongest(days: readonly string[]): number {
  let longest = days.length > 0 ? 1 : 0;
  let current = 1;
  for (let index = 1; index < days.length; index += 1) {
    current = shift(days[index - 1], 1) === days[index] ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

describe("countComebacks", () => {
  it("counts a session after fourteen whole days away, not the very first one", () => {
    expect(countComebacks(["2026-08-01"])).toBe(0);
    expect(countComebacks(["2026-08-01", "2026-08-15"])).toBe(0); // trece días sin venir
    expect(countComebacks(["2026-08-01", "2026-08-16", "2026-08-17", "2026-09-10"])).toBe(2);
  });
});

describe("restDaysSchema", () => {
  it("accepts up to six distinct weekdays", () => {
    expect(restDaysSchema.safeParse({ weekdays: [1, 3, 5, 6, 7] }).success).toBe(true);
  });

  it("rejects marking all seven days as rest", () => {
    const result = restDaysSchema.safeParse({ weekdays: [1, 2, 3, 4, 5, 6, 7] });
    expect(result.success).toBe(false);
  });

  it("rejects a repeated weekday", () => {
    const result = restDaysSchema.safeParse({ weekdays: [1, 1] });
    expect(result.success).toBe(false);
  });

  it("rejects a weekday outside 1-7", () => {
    expect(restDaysSchema.safeParse({ weekdays: [0] }).success).toBe(false);
    expect(restDaysSchema.safeParse({ weekdays: [8] }).success).toBe(false);
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

  it("splits the total into parts that add up to it", () => {
    const metrics: TrainingMetrics = {
      ...NO_TRAINING,
      totalSessions: 2,
      totalSets: 20,
      totalVolumeKg: 5050,
      longestStreakDays: 2,
    };
    const badges = [{ pointsReward: 25 }];
    const breakdown = computePointsBreakdown(metrics, badges);
    expect(breakdown).toEqual({
      session: 100,
      sets: 40,
      volume: 50,
      streak: 20,
      progress: 0,
      badges: 25,
      modes: 0,
      challenges: 0,
      penalties: 0,
      strikePurchases: 0,
    });
    const sum =
      breakdown.session +
      breakdown.sets +
      breakdown.volume +
      breakdown.streak +
      breakdown.progress +
      breakdown.badges +
      breakdown.modes +
      breakdown.challenges -
      breakdown.penalties -
      breakdown.strikePurchases;
    expect(sum).toBe(computePoints(metrics, badges));
  });

  it("adds progress points for personal records and applies penalties and strike purchases", () => {
    const metrics: TrainingMetrics = {
      ...NO_TRAINING,
      totalSessions: 1,
      personalRecords: 2,
    };
    const breakdown = computePointsBreakdown(metrics, [], {
      penaltyPoints: 50,
      purchasedStrikes: 1,
    });
    expect(breakdown.session).toBe(50);
    expect(breakdown.progress).toBe(50); // 2 * 25
    expect(breakdown.penalties).toBe(50);
    expect(breakdown.strikePurchases).toBe(150); // 1 * 150
    // Total: 50 + 50 - 50 - 150 = -100 -> clamped at 0
    expect(computePoints(metrics, [], { penaltyPoints: 50, purchasedStrikes: 1 })).toBe(0);
  });

  it("adds the mode bonuses as their own line, and they only ever add", () => {
    const base = { ...NO_TRAINING, totalSessions: 1 };
    expect(computePoints(base, [])).toBe(50);
    expect(computePoints({ ...base, modeBonusPoints: 300 }, [])).toBe(350);
    expect(computePointsBreakdown({ ...base, modeBonusPoints: 300 }, []).modes).toBe(300);
    expect(computePoints({ ...base, modeBonusPoints: 0 }, [])).toBe(50);
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

describe("badge variety for the reward cards (2026-10-13)", () => {
  const neutral = badgeSeeds.filter((badge) => badge.audience === "ANY");

  it("adds at least thirty badges on top of the original catalogue", () => {
    expect(extendedBadgeSeeds.length).toBeGreaterThanOrEqual(30);
    expect(neutral.length).toBeGreaterThanOrEqual(65);
  });

  it("spreads the new badges over every rarity", () => {
    const byRarity = new Map<string, number>();
    for (const badge of extendedBadgeSeeds) {
      byRarity.set(badge.rarity, (byRarity.get(badge.rarity) ?? 0) + 1);
    }
    for (const rarity of ["COMUN", "RARA", "EPICA", "LEGENDARIA"]) {
      expect(byRarity.get(rarity) ?? 0).toBeGreaterThanOrEqual(6);
    }
  });

  it("covers cardio, social and creator next to the training categories", () => {
    const categories = new Set(extendedBadgeSeeds.map((badge) => badge.category));
    for (const category of ["HITO", "CONSTANCIA", "FUERZA", "CARDIO", "SOCIAL", "CREADOR"]) {
      expect(categories.has(category as never)).toBe(true);
    }
  });

  it("rewards rarer badges with more points inside the same criterion", () => {
    const byCriterion = new Map<string, typeof extendedBadgeSeeds[number][]>();
    for (const badge of neutral) {
      byCriterion.set(badge.criterionType, [...(byCriterion.get(badge.criterionType) ?? []), badge]);
    }
    for (const ladder of byCriterion.values()) {
      const sorted = [...ladder].sort((a, b) => a.criterionThreshold - b.criterionThreshold);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index].pointsReward).toBeGreaterThanOrEqual(sorted[index - 1].pointsReward);
        expect(rarityRank(sorted[index].rarity)).toBeGreaterThanOrEqual(rarityRank(sorted[index - 1].rarity));
      }
    }
  });

  it("gives every badge an illustration and lets the admin create every criterion", () => {
    for (const badge of badgeSeeds) {
      expect(badgeIllustration(badge.code, badge.criterionType)).toMatch(/^[a-z]+(-[a-z]+)*$/u);
      expect(criterionTypeSchema.safeParse(badge.criterionType).success).toBe(true);
    }
    expect(badgeIllustration("PRIMERA_SESION", "SESSION_COUNT")).toBe("first-step");
    expect(badgeIllustration("INVENTADA_POR_UN_GIMNASIO", "STREAK_DAYS")).toBe("streak-flame");
  });

  it("ranks rarities from common to legendary", () => {
    expect(["COMUN", "RARA", "EPICA", "LEGENDARIA"].map(rarityRank)).toEqual([1, 2, 3, 4]);
    expect(rarityRank("DESCONOCIDA")).toBe(1);
  });

  it("measures the new criteria and treats a missing metric as zero", () => {
    const metrics: TrainingMetrics = {
      ...NO_TRAINING,
      totalTrainingMinutes: 615,
      maxSetWeightKg: 102.5,
      timedSecondsTotal: 90,
      cardioTotalMinutes: 75,
      cardioTotalKm: 42.3,
      mondaySessions: 11,
      distinctWeekdays: 7,
      maxSessionsInWeek: 5,
      geoVerifiedSessions: 2,
      supersetSessions: 1,
      routinesCreated: 3,
      routinesPublished: 1,
      routineCopiesReceived: 6,
      commentsWritten: 10,
      ratingsGiven: 1,
      commentLikesReceived: 5,
    };
    const earned = (code: string) => {
      const badge = extendedBadgeSeeds.find((entry) => entry.code === code)!;
      return measure(metrics, badge.criterionType) >= badge.criterionThreshold;
    };
    for (const code of [
      "DIEZ_HORAS", "CLUB_100", "PRIMERA_PLANCHA", "CARDIO_1H", "CARDIO_42K", "LUNES_10",
      "LOS_SIETE_DIAS", "SEMANA_DE_CINCO", "PRESENTE", "PRIMERA_SUPERSERIE", "TRES_RUTINAS",
      "PRIMERA_PUBLICA", "CINCO_DESCARGAS", "DIEZ_COMENTARIOS", "PRIMERA_VALORACION", "CINCO_ME_GUSTA",
    ]) {
      expect([code, earned(code)]).toEqual([code, true]);
    }
    for (const code of ["CLUB_140", "CARDIO_100K", "SEMANA_DE_SEIS", "VEINTICINCO_DESCARGAS", "DIEZ_VALORACIONES"]) {
      expect([code, earned(code)]).toEqual([code, false]);
    }
    expect(measure(NO_TRAINING, "COMMENTS_WRITTEN")).toBe(0);
    expect(measure(NO_TRAINING, "MAX_SET_WEIGHT_KG")).toBe(0);
  });

  it("validates coach and gym social badges and measures their criteria", () => {
    for (const badge of coachRrssBadgeSeeds) {
      expect(badgeIllustration(badge.code, badge.criterionType)).toMatch(/^[a-z]+(-[a-z]+)*$/u);
      expect(criterionTypeSchema.safeParse(badge.criterionType).success).toBe(true);
    }

    const metrics: TrainingMetrics = {
      ...NO_TRAINING,
      gymSocialPartners: 3,
      coachSessions: 1,
      coachClients: 3,
      coachClientsPrs: 10,
    };

    expect(measure(metrics, "GYM_SOCIAL_PARTNERS")).toBe(3);
    expect(measure(metrics, "COACH_SESSIONS")).toBe(1);
    expect(measure(metrics, "COACH_CLIENTS")).toBe(3);
    expect(measure(metrics, "COACH_CLIENTS_PRS")).toBe(10);

    const earned = (code: string) => {
      const badge = coachRrssBadgeSeeds.find((entry) => entry.code === code)!;
      return measure(metrics, badge.criterionType) >= badge.criterionThreshold;
    };

    expect(earned("HABLAR_3_PERSONAS")).toBe(true);
    expect(earned("COMUNIDAD_GYM_10")).toBe(false); // threshold 10
    expect(earned("COACH_PRIMERA_SESION")).toBe(true);
    expect(earned("COACH_DIEZ_SESIONES")).toBe(false); // threshold 10
    expect(earned("COACH_TRES_ATLETAS")).toBe(true);
    expect(earned("COACH_DIEZ_RECORDS")).toBe(true);

    expect(measure(NO_TRAINING, "GYM_SOCIAL_PARTNERS")).toBe(0);
    expect(measure(NO_TRAINING, "COACH_SESSIONS")).toBe(0);
    expect(measure(NO_TRAINING, "COACH_CLIENTS")).toBe(0);
    expect(measure(NO_TRAINING, "COACH_CLIENTS_PRS")).toBe(0);
  });
});


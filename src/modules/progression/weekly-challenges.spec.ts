import {
  CHALLENGE_POINTS,
  EMPTY_WEEK,
  StoredChallenge,
  WeekMeasures,
  averageWeeks,
  challengeTarget,
  generateWeeklyChallenges,
  mondayOfDate,
  toChallengeView,
  toWeeklyView,
  zonedMidnightIso,
} from "./weekly-challenges";

const week = (values: Partial<WeekMeasures>): WeekMeasures => ({ ...EMPTY_WEEK, ...values });

const ACTIVE: WeekMeasures[] = [
  week({ SESSIONS: 4, SETS: 60, VOLUME_KG: 12000, MUSCLE_GROUPS: 6, CARDIO_MINUTES: 40, GEO_SESSIONS: 3, EARLY_SESSION: 1 }),
  week({ SESSIONS: 3, SETS: 50, VOLUME_KG: 10000, MUSCLE_GROUPS: 5, CARDIO_MINUTES: 20, GEO_SESSIONS: 2 }),
  week({ SESSIONS: 4, SETS: 55, VOLUME_KG: 11000, MUSCLE_GROUPS: 6, GEO_SESSIONS: 3 }),
  week({ SESSIONS: 5, SETS: 70, VOLUME_KG: 15000, MUSCLE_GROUPS: 7, CARDIO_MINUTES: 60, GEO_SESSIONS: 4 }),
];

describe("generateWeeklyChallenges", () => {
  it("gives three challenges, one per difficulty, in order and without repeating a kind", () => {
    const challenges = generateWeeklyChallenges({ userId: "u-1", weekStart: "2026-10-12", history: ACTIVE });
    expect(challenges.map((c) => c.difficulty)).toEqual(["FACIL", "MEDIO", "DIFICIL"]);
    expect(new Set(challenges.map((c) => c.kind)).size).toBe(3);
    expect(challenges.map((c) => c.pointsReward)).toEqual([60, 100, 160]);
    expect(challenges.every((c) => c.code === c.kind && c.target > 0)).toBe(true);
  });

  it("is deterministic for the same person and week, and varies across people and weeks", () => {
    const pick = (userId: string, weekStart: string) =>
      generateWeeklyChallenges({ userId, weekStart, history: ACTIVE });
    expect(pick("u-1", "2026-10-12")).toEqual(pick("u-1", "2026-10-12"));

    const combos = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      combos.add(pick(`u-${index}`, "2026-10-12").map((c) => c.kind).join(","));
      combos.add(pick("u-1", mondayOfDate(`2026-${String((index % 12) + 1).padStart(2, "0")}-15`)).map((c) => c.kind).join(","));
    }
    expect(combos.size).toBeGreaterThan(5);
  });

  it("personalises the targets from the average of the last weeks", () => {
    const busy = generateWeeklyChallenges({ userId: "u-2", weekStart: "2026-10-12", history: ACTIVE });
    const newcomer = generateWeeklyChallenges({ userId: "u-2", weekStart: "2026-10-12", history: [] });
    const sessions = (list: typeof busy) => list.find((c) => c.kind === "SESSIONS");
    // Misma semilla, mismo sorteo cuando ambos pueden recibir el mismo tipo:
    // lo que cambia es la exigencia.
    expect(challengeTarget("SESSIONS", "MEDIO", averageWeeks(ACTIVE).SESSIONS)).toBe(4);
    expect(challengeTarget("SESSIONS", "MEDIO", 0)).toBe(2);
    expect(challengeTarget("VOLUME_KG", "DIFICIL", averageWeeks(ACTIVE).VOLUME_KG)).toBe(15000);
    expect(challengeTarget("VOLUME_KG", "FACIL", 0)).toBe(1000);
    if (sessions(busy) && sessions(newcomer)) {
      expect(sessions(busy)!.target).toBeGreaterThanOrEqual(sessions(newcomer)!.target);
    }
  });

  it("caps targets that cannot grow forever", () => {
    expect(challengeTarget("SESSIONS", "DIFICIL", 9)).toBe(7);
    expect(challengeTarget("WEEKEND_SESSION", "DIFICIL", 5)).toBe(2);
  });

  it("never proposes cardio, gym check-ins, early sessions or records to someone without that history", () => {
    for (let index = 0; index < 200; index += 1) {
      const kinds = generateWeeklyChallenges({ userId: `nuevo-${index}`, weekStart: "2026-10-12", history: [] }).map(
        (c) => c.kind,
      );
      for (const kind of ["CARDIO_MINUTES", "GEO_SESSIONS", "EARLY_SESSION", "PERSONAL_RECORD"]) {
        expect(kinds).not.toContain(kind);
      }
    }
  });

  it("counts a week without training as zero in the average", () => {
    expect(averageWeeks([week({ SESSIONS: 4 }), EMPTY_WEEK, EMPTY_WEEK, EMPTY_WEEK]).SESSIONS).toBe(1);
  });
});

describe("challenge views", () => {
  const stored = (values: Partial<StoredChallenge> = {}): StoredChallenge => ({
    code: "VOLUME_KG",
    kind: "VOLUME_KG",
    difficulty: "MEDIO",
    target: 12000,
    pointsReward: CHALLENGE_POINTS.MEDIO,
    completedAt: null,
    seen: false,
    ...values,
  });

  it("measures progress with a readable label and clamps it at the target", () => {
    const view = toChallengeView(stored(), 8400);
    expect(view).toMatchObject({
      title: "Mueve 12.000 kg",
      current: 8400,
      progress: 0.7,
      progressLabel: "8.400 kg / 12.000 kg",
      completed: false,
      isNew: false,
    });
    expect(toChallengeView(stored(), 20000)).toMatchObject({ current: 12000, progress: 1, completed: true, isNew: true });
  });

  it("keeps a completed challenge completed even if the measure drops later", () => {
    const view = toChallengeView(stored({ completedAt: new Date("2026-10-14T10:00:00Z"), seen: true }), 0);
    expect(view).toMatchObject({ completed: true, current: 12000, isNew: false, completedAt: "2026-10-14T10:00:00.000Z" });
  });

  it("builds the week in FACIL → MEDIO → DIFICIL order and detects the perfect week", () => {
    const items = [
      toChallengeView(stored({ code: "PERSONAL_RECORD", kind: "PERSONAL_RECORD", difficulty: "DIFICIL", target: 1, pointsReward: 160 }), 1),
      toChallengeView(stored({ code: "SESSIONS", kind: "SESSIONS", difficulty: "FACIL", target: 2, pointsReward: 60 }), 2),
      toChallengeView(stored(), 12000),
    ];
    const view = toWeeklyView({ weekStart: "2026-10-12", endsAt: "2026-10-19T04:00:00.000Z", items });
    expect(view.items.map((item) => item.difficulty)).toEqual(["FACIL", "MEDIO", "DIFICIL"]);
    expect(view).toMatchObject({ completedCount: 3, perfect: true, perfectBonus: 150, perfectIsNew: true });

    const half = toWeeklyView({ weekStart: "2026-10-12", endsAt: "x", items: items.slice(0, 2).concat(toChallengeView(stored(), 0)) });
    expect(half).toMatchObject({ completedCount: 2, perfect: false, perfectIsNew: false });
  });
});

describe("calendar helpers", () => {
  it("finds the Monday of any date", () => {
    expect(mondayOfDate("2026-10-18")).toBe("2026-10-12"); // domingo
    expect(mondayOfDate("2026-10-12")).toBe("2026-10-12");
  });

  it("returns local midnight in the business time zone", () => {
    expect(zonedMidnightIso("2026-10-19", "America/La_Paz")).toBe("2026-10-19T04:00:00.000Z");
    expect(zonedMidnightIso("2026-10-19", "UTC")).toBe("2026-10-19T00:00:00.000Z");
    expect(zonedMidnightIso("2026-07-06", "Europe/Madrid")).toBe("2026-07-05T22:00:00.000Z");
  });
});

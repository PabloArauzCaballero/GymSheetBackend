import { computeStreaks } from "./progression.repository";
import { settleStrikes, totalOf } from "./streak-strikes";

/** Plan de lunes a viernes: sábado (6) y domingo (7) de descanso. */
const WEEKEND_REST = new Set([6, 7]);

/** Semana del lunes 2 al domingo 8 de noviembre de 2026. */
const base = {
  restWeekdays: WEEKEND_REST,
  planDeclared: true,
  purchasedByMonth: {},
  monthlyStrikes: 3,
  effectiveFrom: "2026-11-01",
};

describe("strikes de racha", () => {
  it("sin plan declarado no hay faltas, ni strikes, ni penalizaciones", () => {
    const result = settleStrikes({ ...base, planDeclared: false, trainingDays: ["2026-11-02"], today: "2026-11-30" });
    expect(totalOf(result.usedByMonth)).toBe(0);
    expect(totalOf(result.penalizedByMonth)).toBe(0);
  });

  it("una falta repuesta en un día de descanso de la misma semana no cuesta nada", () => {
    // Falta el martes 3, entrena el sábado 7.
    const result = settleStrikes({
      ...base,
      trainingDays: ["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"],
      today: "2026-11-09",
    });
    expect(result.forgivenDays.has("2026-11-03")).toBe(true);
    expect(totalOf(result.usedByMonth)).toBe(0);
  });

  it("una falta de la semana en curso queda pendiente de reponer", () => {
    const result = settleStrikes({ ...base, trainingDays: ["2026-11-02"], today: "2026-11-04" });
    expect(result.pendingThisWeek).toBe(1);
    expect(totalOf(result.usedByMonth)).toBe(0);
    expect(totalOf(result.penalizedByMonth)).toBe(0);
  });

  it("gasta los tres strikes del mes y después penaliza", () => {
    // Semana del 2: entrena solo el lunes → faltan martes a viernes (4 faltas).
    const result = settleStrikes({ ...base, trainingDays: ["2026-11-02"], today: "2026-11-10" });
    expect(result.usedByMonth["2026-11"]).toBe(3);
    expect(result.penalizedByMonth["2026-11"]).toBe(1);
  });

  it("los strikes comprados se suman a los del mes de la falta", () => {
    const result = settleStrikes({
      ...base,
      purchasedByMonth: { "2026-11": 1 },
      trainingDays: ["2026-11-02"],
      today: "2026-11-10",
    });
    expect(result.usedByMonth["2026-11"]).toBe(4);
    expect(totalOf(result.penalizedByMonth)).toBe(0);
  });

  it("no penaliza semanas enteras sin entrenar: quien deja de venir pierde la racha, no los puntos", () => {
    const result = settleStrikes({ ...base, trainingDays: ["2026-11-02"], today: "2026-12-01" });
    // Solo la semana del 2 tuvo entrenos: 4 faltas → 3 strikes + 1 penalización.
    expect(result.penalizedByMonth["2026-11"]).toBe(1);
  });

  it("nada retroactivo: las faltas antes de la entrada en vigor no cuentan", () => {
    const result = settleStrikes({
      ...base,
      effectiveFrom: "2026-11-09",
      trainingDays: ["2026-11-02"],
      today: "2026-11-10",
    });
    expect(totalOf(result.usedByMonth)).toBe(0);
    expect(totalOf(result.penalizedByMonth)).toBe(0);
  });

  it("es determinista: recalcular da lo mismo", () => {
    const input = { ...base, trainingDays: ["2026-11-02", "2026-11-09"], today: "2026-11-20" };
    expect(settleStrikes(input)).toEqual(settleStrikes(input));
  });

  it("una falta cubierta por strike no corta la racha; una penalizada sí", () => {
    // Entrena lunes y martes, falta el miércoles 4 y vuelve el jueves 5.
    const trainingDays = ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"];
    const today = "2026-11-10";
    const covered = settleStrikes({ ...base, trainingDays, today });
    expect(covered.usedByMonth["2026-11"]).toBe(1);
    expect(computeStreaks(trainingDays, today, WEEKEND_REST, covered.forgivenDays).longest).toBe(4);

    const noStrikes = settleStrikes({ ...base, monthlyStrikes: 0, trainingDays, today });
    expect(noStrikes.penalizedByMonth["2026-11"]).toBe(1);
    expect(computeStreaks(trainingDays, today, WEEKEND_REST, noStrikes.forgivenDays).longest).toBe(2);
  });
});

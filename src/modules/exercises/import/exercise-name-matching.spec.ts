import {
  exerciseNameKey,
  exerciseNameTokens,
  normalizeEquipmentName,
} from "./exercises-dataset.repository";

/**
 * Lo que se fija aquí son las parejas reales medidas entre `free-exercise-db` y
 * nuestro catálogo: las que deben casar y, sobre todo, las que NO deben casar,
 * porque una lámina colgada del ejercicio equivocado enseña otro movimiento.
 */
describe("exerciseNameKey", () => {
  it("ignora orden, mayúsculas y plurales", () => {
    expect(exerciseNameKey("barbell standing calf raise")).toBe(
      exerciseNameKey("Standing Barbell Calf Raises"),
    );
  });

  it("ignora lo que va entre paréntesis", () => {
    expect(exerciseNameKey("cable triceps pushdown (v-bar)")).toBe(
      exerciseNameKey("Cable Triceps Pushdown"),
    );
  });

  it("ignora conectores como with u on", () => {
    expect(exerciseNameKey("lateral raise with bands")).toBe(
      exerciseNameKey("lateral raise bands"),
    );
  });

  /** Medido: tolerar «standing»/«seated» emparejaba dos ejercicios distintos. */
  it("de pie y sentado no son el mismo ejercicio", () => {
    expect(exerciseNameKey("barbell standing twist")).not.toBe(
      exerciseNameKey("Seated Barbell Twist"),
    );
  });

  it("un press de banca no es un press guillotina", () => {
    expect(exerciseNameKey("barbell bench press")).not.toBe(
      exerciseNameKey("Barbell Guillotine Bench Press"),
    );
  });

  it("una sentadilla zercher no es una sentadilla completa", () => {
    expect(exerciseNameKey("barbell full zercher squat")).not.toBe(
      exerciseNameKey("Barbell Full Squat"),
    );
  });
});

describe("exerciseNameTokens", () => {
  it("normaliza sinónimos de catálogo", () => {
    expect([...exerciseNameTokens("DB curl")]).toContain("dumbbell");
  });
});

describe("normalizeEquipmentName", () => {
  it("unifica los nombres que cada catálogo usa para lo mismo", () => {
    expect(normalizeEquipmentName("leverage machine")).toBe("machine");
    expect(normalizeEquipmentName("band")).toBe("bands");
    expect(normalizeEquipmentName("body weight")).toBe("body only");
  });

  it("una banda y una mancuerna siguen siendo distintas", () => {
    expect(normalizeEquipmentName("band")).not.toBe(
      normalizeEquipmentName("dumbbell"),
    );
  });

  it("trata el vacío como vacío, no como un equipo", () => {
    expect(normalizeEquipmentName(null)).toBe("");
  });
});

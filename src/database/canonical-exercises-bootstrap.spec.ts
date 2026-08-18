import { planCanonicalExercisesBootstrap } from "./canonical-exercises-bootstrap";

describe("planCanonicalExercisesBootstrap", () => {
  it("defers to the worker in github mode when the dataset is enabled", () => {
    expect(planCanonicalExercisesBootstrap("github", true)).toEqual({
      source: "github",
      action: "defer-to-worker",
    });
  });

  it("throws in github mode when the dataset is disabled (no silent fallback)", () => {
    expect(() => planCanonicalExercisesBootstrap("github", false)).toThrow(
      /EXERCISES_DATASET_ENABLED/,
    );
  });

  it("uses the local snapshot in seeders mode regardless of dataset flag", () => {
    expect(planCanonicalExercisesBootstrap("seeders", false)).toEqual({
      source: "seeders",
      action: "seed-local-snapshot",
    });
    expect(planCanonicalExercisesBootstrap("seeders", true).action).toBe(
      "seed-local-snapshot",
    );
  });
});

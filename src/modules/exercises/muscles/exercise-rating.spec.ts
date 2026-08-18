import { computeExerciseRating } from "./exercise-rating";

describe("computeExerciseRating", () => {
  it("rates a compound, accessible strength lift highly", () => {
    const rating = computeExerciseRating({
      category: "strength",
      requiredEquipment: "body only",
      primaryMuscleCount: 2,
      secondaryMuscleCount: 3,
    });
    expect(rating.recommendedStars).toBeGreaterThanOrEqual(4);
    expect(rating.funStars).toBeGreaterThanOrEqual(3);
  });

  it("rates an isolated machine stretch lower for recommendation", () => {
    const rating = computeExerciseRating({
      category: "stretching",
      requiredEquipment: "machine",
      primaryMuscleCount: 1,
      secondaryMuscleCount: 0,
    });
    expect(rating.recommendedStars).toBeLessThanOrEqual(2);
  });

  it("gives plyometrics high fun", () => {
    const rating = computeExerciseRating({
      category: "plyometrics",
      requiredEquipment: "body only",
      primaryMuscleCount: 2,
      secondaryMuscleCount: 2,
    });
    expect(rating.funStars).toBeGreaterThanOrEqual(4);
  });

  it("always returns stars within 1..5 and exposes factors", () => {
    for (const total of [0, 1, 2, 3, 5]) {
      const rating = computeExerciseRating({
        category: null,
        requiredEquipment: null,
        primaryMuscleCount: total,
        secondaryMuscleCount: 0,
      });
      expect(rating.recommendedStars).toBeGreaterThanOrEqual(1);
      expect(rating.recommendedStars).toBeLessThanOrEqual(5);
      expect(rating.funStars).toBeGreaterThanOrEqual(1);
      expect(rating.funStars).toBeLessThanOrEqual(5);
      expect(rating.factors.totalMuscles).toBe(total);
    }
  });
});

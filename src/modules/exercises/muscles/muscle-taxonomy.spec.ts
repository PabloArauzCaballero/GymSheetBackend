import {
  groupOfMuscle,
  muscleGroups,
  muscles,
  normalizeMuscleLabel,
} from "./muscle-taxonomy";

describe("muscle taxonomy", () => {
  it("keeps referential integrity: every muscle belongs to a real group", () => {
    const groupCodes = new Set(muscleGroups.map((group) => group.code));
    for (const muscle of muscles)
      expect(groupCodes.has(muscle.groupCode)).toBe(true);
  });

  it("has unique muscle and group codes", () => {
    expect(new Set(muscles.map((m) => m.code)).size).toBe(muscles.length);
    expect(new Set(muscleGroups.map((g) => g.code)).size).toBe(
      muscleGroups.length,
    );
  });

  describe("normalizeMuscleLabel", () => {
    it.each([
      ["chest", "PECTORALIS_MAJOR"],
      ["Pectorals", "PECTORALIS_MAJOR"],
      ["lats", "LATISSIMUS_DORSI"],
      ["upper back", "TRAPEZIUS"],
      ["middle back", "RHOMBOIDS"],
      ["quads", "QUADRICEPS"],
      ["Glúteos", "GLUTEUS_MAXIMUS"],
      ["hip flexors", "HIP_FLEXORS"],
      ["delts", "DELTOID"],
      ["cardiovascular system", "CARDIOVASCULAR"],
      ["  Triceps  ", "TRICEPS_BRACHII"],
    ])("maps %s -> %s", (raw, expected) => {
      expect(normalizeMuscleLabel(raw)).toBe(expected);
    });

    it("returns null for unknown or empty labels", () => {
      expect(normalizeMuscleLabel("teleportation muscle")).toBeNull();
      expect(normalizeMuscleLabel("")).toBeNull();
      expect(normalizeMuscleLabel(null)).toBeNull();
    });

    it("resolves a canonical code written directly", () => {
      expect(normalizeMuscleLabel("GLUTEUS_MEDIUS")).toBe("GLUTEUS_MEDIUS");
    });
  });

  it("resolves the group of a muscle", () => {
    expect(groupOfMuscle("BICEPS_BRACHII")).toBe("ARMS");
    expect(groupOfMuscle("UNKNOWN")).toBeNull();
  });
});

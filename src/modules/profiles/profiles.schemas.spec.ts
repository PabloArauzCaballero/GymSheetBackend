import { TrainingGoal } from "../../common/enums/domain.enums";
import { ageFromBirthDate, isCalendarDate } from "./birth-date";
import { mapProfileToResponse } from "./profile.mapper";
import { AnthropometricProfileModel } from "./anthropometric-profile.model";
import { upsertProfileSchema } from "./profiles.schemas";

const base = { pesoKg: 75, estaturaCm: 180, objetivo: TrainingGoal.HYPERTROPHY };

function yearsAgo(years: number): string {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear() - years, 0, 1)).toISOString().slice(0, 10);
}

describe("birth date helpers", () => {
  it("counts a birthday that has not happened yet this year", () => {
    const today = new Date("2026-09-15T12:00:00.000Z");
    expect(ageFromBirthDate("1996-09-16", today)).toBe(29);
    expect(ageFromBirthDate("1996-09-15", today)).toBe(30);
  });

  it("rejects days that do not exist", () => {
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("15/03/1996")).toBe(false);
  });
});

describe("upsertProfileSchema", () => {
  it("passes the birth date through for the account and stores no separate age", () => {
    const parsed = upsertProfileSchema.parse({ ...base, fechaNacimiento: yearsAgo(30) });
    expect(parsed).toMatchObject({ birthDate: yearsAgo(30) });
    expect(parsed).not.toHaveProperty("age");
  });

  it("rejects ages outside 18 to 100", () => {
    expect(upsertProfileSchema.safeParse({ ...base, fechaNacimiento: yearsAgo(5) }).success).toBe(false);
    expect(upsertProfileSchema.safeParse({ ...base, fechaNacimiento: yearsAgo(120) }).success).toBe(false);
  });

  describe("18+ boundary on a fixed clock", () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date("2026-11-16T12:00:00.000Z") }));
    afterEach(() => jest.useRealTimers());

    it("rejects someone who turns 18 tomorrow (17 years and 364 days)", () => {
      const result = upsertProfileSchema.safeParse({ ...base, fechaNacimiento: "2008-11-17" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe("Debes tener al menos 18 años.");
    });

    it("accepts someone who turns exactly 18 today", () => {
      const parsed = upsertProfileSchema.parse({ ...base, fechaNacimiento: "2008-11-16" });
      expect(parsed).toMatchObject({ birthDate: "2008-11-16" });
    });
  });

  it("applies the same 18+ floor to the legacy age field", () => {
    const result = upsertProfileSchema.safeParse({ ...base, edad: 17 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Debes tener al menos 18 años.");
    expect(upsertProfileSchema.safeParse({ ...base, edad: 18 }).success).toBe(true);
  });

  it("still accepts the legacy age from installed app versions without touching the date", () => {
    const parsed = upsertProfileSchema.parse({ ...base, edad: 28 });
    expect(parsed).not.toHaveProperty("age");
    expect(parsed).not.toHaveProperty("birthDate");
  });

  it("leaves both fields untouched when neither is sent", () => {
    const parsed = upsertProfileSchema.parse(base);
    expect(parsed).not.toHaveProperty("age");
    expect(parsed).not.toHaveProperty("birthDate");
  });

  it("clears the birth date when it is explicitly null", () => {
    expect(upsertProfileSchema.parse({ ...base, fechaNacimiento: null })).toMatchObject({
      birthDate: null,
    });
  });
});

describe("mapProfileToResponse", () => {
  const profile = {
    id: "p",
    userId: "u",
    weightKg: "80.00",
    heightCm: 180,
    goal: TrainingGoal.STRENGTH,
    measurementUpdatedAt: new Date(),
  } as AnthropometricProfileModel;

  it("derives the age from the account birth date", () => {
    const response = mapProfileToResponse(profile, yearsAgo(40));
    expect(response).toMatchObject({ edad: 40, fechaNacimiento: yearsAgo(40) });
  });

  it("reports no age when the account has no birth date", () => {
    expect(mapProfileToResponse(profile, null)).toMatchObject({ edad: null, fechaNacimiento: null });
  });
});

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
  it("stores the birth date and derives the age from it", () => {
    const parsed = upsertProfileSchema.parse({ ...base, fechaNacimiento: yearsAgo(30) });
    expect(parsed).toMatchObject({ birthDate: yearsAgo(30), age: 30 });
  });

  it("rejects ages outside 12 to 100", () => {
    expect(upsertProfileSchema.safeParse({ ...base, fechaNacimiento: yearsAgo(5) }).success).toBe(false);
    expect(upsertProfileSchema.safeParse({ ...base, fechaNacimiento: yearsAgo(120) }).success).toBe(false);
  });

  it("still accepts the legacy age from installed app versions without touching the date", () => {
    const parsed = upsertProfileSchema.parse({ ...base, edad: 28 });
    expect(parsed).toMatchObject({ age: 28 });
    expect(parsed).not.toHaveProperty("birthDate");
  });

  it("leaves both fields untouched when neither is sent", () => {
    const parsed = upsertProfileSchema.parse(base);
    expect(parsed).not.toHaveProperty("age");
    expect(parsed).not.toHaveProperty("birthDate");
  });

  it("clears both fields when the birth date is explicitly null", () => {
    expect(upsertProfileSchema.parse({ ...base, fechaNacimiento: null })).toMatchObject({
      birthDate: null,
      age: null,
    });
  });
});

describe("mapProfileToResponse", () => {
  it("prefers the age computed from the birth date over the stored one", () => {
    const response = mapProfileToResponse({
      id: "p",
      userId: "u",
      age: 18,
      birthDate: yearsAgo(40),
      weightKg: "80.00",
      heightCm: 180,
      goal: TrainingGoal.STRENGTH,
      measurementUpdatedAt: new Date(),
    } as AnthropometricProfileModel);
    expect(response).toMatchObject({ edad: 40, fechaNacimiento: yearsAgo(40) });
  });
});

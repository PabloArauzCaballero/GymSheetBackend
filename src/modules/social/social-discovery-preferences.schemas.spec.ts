import { discoveryPreferencesInputSchema } from "./social.schemas";

const valid = {
  genders: ["FEMALE"], intents: ["TRAINING"], minAge: 18, maxAge: 65,
  radiusKm: 25, flexibleAge: false, flexibleDistance: false, expectedVersion: 0,
};

describe("discoveryPreferencesInputSchema", () => {
  it("requires at least one gender and an adult age range", () => {
    expect(discoveryPreferencesInputSchema.safeParse({ ...valid, genders: [] }).success).toBe(false);
    expect(discoveryPreferencesInputSchema.safeParse({ ...valid, minAge: 17 }).success).toBe(false);
    expect(discoveryPreferencesInputSchema.safeParse({ ...valid, minAge: 40, maxAge: 30 }).success).toBe(false);
  });

  it("rejects duplicated filters and bounds the radius", () => {
    expect(discoveryPreferencesInputSchema.safeParse({ ...valid, genders: ["FEMALE", "FEMALE"] }).success).toBe(false);
    expect(discoveryPreferencesInputSchema.safeParse({ ...valid, radiusKm: 501 }).success).toBe(false);
  });

  it("accepts explicit preferences and an optimistic version", () => {
    expect(discoveryPreferencesInputSchema.safeParse(valid).success).toBe(true);
  });
});

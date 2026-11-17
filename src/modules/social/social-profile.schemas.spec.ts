import { INTEREST_CATALOG, INTEREST_CODES } from "./social-profile.catalog";
import {
  bioContainsPhone,
  bioContainsUrl,
  updateSocialProfileSchema,
} from "./social-profile.schemas";
import { discoveryPreferencesInputSchema } from "./social.schemas";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("social profile catalog", () => {
  it("exposes unique UPPER_SNAKE codes, each with a Spanish label", () => {
    expect(INTEREST_CODES.length).toBeGreaterThanOrEqual(35);
    expect(new Set(INTEREST_CODES).size).toBe(INTEREST_CODES.length);
    for (const entry of INTEREST_CATALOG) {
      expect(entry.code).toMatch(/^[A-Z]+(?:_[A-Z]+)*$/u);
      expect(entry.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("updateSocialProfileSchema", () => {
  it("fills omitted answers as not answered and keeps orientation hidden by default", () => {
    expect(updateSocialProfileSchema.parse({ expectedVersion: 0 })).toEqual({
      orientation: null,
      orientationVisible: false,
      interests: [],
      drinking: null,
      smoking: null,
      pets: null,
      bio: null,
      expectedVersion: 0,
    });
  });

  it("accepts a full profile, trims the bio and drops undeclared fields", () => {
    const parsed = updateSocialProfileSchema.parse({
      orientation: "BISEXUAL",
      orientationVisible: true,
      interests: ["RUNNING", "COOKING"],
      drinking: "SOCIALLY",
      smoking: "NEVER",
      pets: "DOG",
      bio: "  Entreno fuerza desde 2019 y corro 10k los domingos.  ",
      expectedVersion: 3,
      userId: "someone-else",
    });
    expect(parsed.bio).toBe("Entreno fuerza desde 2019 y corro 10k los domingos.");
    expect(parsed).not.toHaveProperty("userId");
  });

  it("stores a blank bio as null", () => {
    expect(updateSocialProfileSchema.parse({ bio: "   ", expectedVersion: 1 }).bio).toBeNull();
  });

  it("rejects more than five, duplicated or unknown interests", () => {
    const six = INTEREST_CODES.slice(0, 6);
    expect(messages(updateSocialProfileSchema.safeParse({ interests: six, expectedVersion: 0 })))
      .toContain("Elige hasta 5 intereses.");
    expect(messages(updateSocialProfileSchema.safeParse({ interests: ["YOGA", "YOGA"], expectedVersion: 0 })))
      .toContain("No se permiten intereses duplicados.");
    expect(updateSocialProfileSchema.safeParse({ interests: ["KNITTING"], expectedVersion: 0 }).success)
      .toBe(false);
  });

  it("rejects values outside the closed habit and orientation catalogs", () => {
    for (const body of [
      { orientation: "OTHER" },
      { drinking: "DAILY" },
      { smoking: "SOCIALLY" },
      { pets: "FISH" },
      { orientationVisible: "yes" },
    ]) {
      expect(updateSocialProfileSchema.safeParse({ ...body, expectedVersion: 0 }).success).toBe(false);
    }
  });

  it("rejects bios over 500 characters", () => {
    expect(updateSocialProfileSchema.safeParse({ bio: "a".repeat(501), expectedVersion: 0 }).success)
      .toBe(false);
    expect(updateSocialProfileSchema.safeParse({ bio: "a".repeat(500), expectedVersion: 0 }).success)
      .toBe(true);
  });

  it.each([
    "Escríbeme en https://example.com",
    "visita www.mipagina.net",
    "mi correo es ana.perez@gmail.com",
    "sígueme en ana-fit.app",
  ])("rejects a bio with a URL: %s", (bio) => {
    expect(bioContainsUrl(bio)).toBe(true);
    expect(messages(updateSocialProfileSchema.safeParse({ bio, expectedVersion: 0 })))
      .toContain("Tu bio no puede incluir enlaces ni direcciones web.");
  });

  it.each(["Llámame al +591 70012345", "wsp 700-123-45", "(2) 245 6789"])(
    "rejects a bio with a phone number: %s",
    (bio) => {
      expect(bioContainsPhone(bio)).toBe(true);
      expect(messages(updateSocialProfileSchema.safeParse({ bio, expectedVersion: 0 })))
        .toContain("Tu bio no puede incluir números de teléfono.");
    },
  );

  it.each([
    "Peso 80 kg, mido 1.75 y hago 5x5.",
    "Corro desde 2015. Me encanta el café.",
    "Hola.que tal, busco compañero de pierna",
  ])("keeps ordinary bios: %s", (bio) => {
    expect(bioContainsUrl(bio)).toBe(false);
    expect(bioContainsPhone(bio)).toBe(false);
  });
});

describe("discovery intents with UNSURE", () => {
  const base = {
    genders: ["MALE", "FEMALE"],
    minAge: 18,
    maxAge: 40,
    radiusKm: 10,
    flexibleAge: false,
    flexibleDistance: false,
    expectedVersion: 0,
  };

  it("accepts UNSURE on its own", () => {
    expect(discoveryPreferencesInputSchema.parse({ ...base, intents: ["UNSURE"] }).intents)
      .toEqual(["UNSURE"]);
  });

  it("rejects UNSURE combined with another intent", () => {
    expect(messages(discoveryPreferencesInputSchema.safeParse({ ...base, intents: ["UNSURE", "DATING"] })))
      .toContain("«Aún no lo sé» no se combina con otras opciones.");
  });

  it("keeps accepting the three concrete intents together", () => {
    expect(
      discoveryPreferencesInputSchema.safeParse({
        ...base,
        intents: ["TRAINING", "FRIENDSHIP", "DATING"],
      }).success,
    ).toBe(true);
  });
});

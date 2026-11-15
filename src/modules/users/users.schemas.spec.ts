import { updateMyAccountSchema } from "./users.schemas";

describe("updateMyAccountSchema", () => {
  it("accepts a positive weight increment", () => {
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: 1.25 }).success).toBe(true);
  });

  it("rejects a zero or negative increment", () => {
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: 0 }).success).toBe(false);
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: -2.5 }).success).toBe(false);
  });

  it("rejects an unrealistically large increment", () => {
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: 51 }).success).toBe(false);
  });

  it("rejects an empty update", () => {
    expect(updateMyAccountSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a branch uuid and rejects anything else", () => {
    expect(
      updateMyAccountSchema.safeParse({ sedeId: "3f1c2b7e-8a4d-4c1e-9b2a-5d6e7f8a9b0c" }).success,
    ).toBe(true);
    expect(updateMyAccountSchema.safeParse({ sedeId: "sede-1" }).success).toBe(false);
  });

  it("trims the bio, flattens line breaks and stores an empty one as null", () => {
    expect(updateMyAccountSchema.parse({ bio: "  Pierna los lunes.\n\nCafé después.  " })).toEqual({
      bio: "Pierna los lunes. Café después.",
    });
    expect(updateMyAccountSchema.parse({ bio: "   " })).toEqual({ bio: null });
    expect(updateMyAccountSchema.parse({ bio: null })).toEqual({ bio: null });
  });

  it.each([
    ["zero-width space U+200B", "\u200B"],
    ["BOM U+FEFF", "\uFEFF\uFEFF"],
    ["word joiner U+2060", "\u2060"],
    ["bidi isolate U+2066", "\u2066\u2069"],
    ["soft hyphen U+00AD", "\u00AD"],
    ["stray zero-width joiner U+200D", "\u200D"],
    ["Hangul filler U+3164", "\u3164\u3164"],
    ["Hangul choseong filler U+115F", "\u115F"],
    ["Hangul jungseong filler U+1160", "\u1160"],
    ["halfwidth Hangul filler U+FFA0", "\uFFA0"],
    ["braille blank U+2800", "\u2800"],
  ])("stores an invisible-only bio (%s) as null", (_name, bio) => {
    expect(updateMyAccountSchema.parse({ bio })).toEqual({ bio: null });
    expect(updateMyAccountSchema.parse({ bio: ` ${bio} ${bio} ` })).toEqual({ bio: null });
  });

  it("strips bidi overrides and stray joiners but keeps the text and emoji sequences", () => {
    expect(updateMyAccountSchema.parse({ bio: "\u202Eabc" })).toEqual({ bio: "abc" });
    expect(updateMyAccountSchema.parse({ bio: "Pier\u200Bna\u200D lunes\u3164" })).toEqual({ bio: "Pierna lunes" });
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const flexSkin = "\u{1F3CB}\u{1F3FD}\u200D\u2640\uFE0F";
    expect(updateMyAccountSchema.parse({ bio: `Con ${family} y ${flexSkin}` })).toEqual({ bio: `Con ${family} y ${flexSkin}` });
  });

  it("rejects a bio longer than 160 characters", () => {
    expect(updateMyAccountSchema.safeParse({ bio: "a".repeat(161) }).success).toBe(false);
    expect(updateMyAccountSchema.safeParse({ bio: "a".repeat(160) }).success).toBe(true);
  });
});

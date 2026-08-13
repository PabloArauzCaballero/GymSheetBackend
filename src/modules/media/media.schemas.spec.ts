import { mediaUploadMetadataSchema } from "./media.schemas";

describe("mediaUploadMetadataSchema", () => {
  const valid = {
    code: "membership-plan-basic-cover",
    name: "Portada plan mensual",
    altText: "Zona de entrenamiento",
  };

  it("applies license/attribution defaults and coerces dimensions", () => {
    const parsed = mediaUploadMetadataSchema.parse({
      ...valid,
      width: "1200",
      height: "800",
    });
    expect(parsed.license).toBe("Propietaria");
    expect(parsed.attribution).toBe("GymSheet");
    expect(parsed.width).toBe(1200);
    expect(parsed.height).toBe(800);
  });

  it("rejects a width without a height (mirrors ck_media_dimensions)", () => {
    const result = mediaUploadMetadataSchema.safeParse({
      ...valid,
      width: "1200",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-kebab-case code and unknown fields", () => {
    expect(
      mediaUploadMetadataSchema.safeParse({ ...valid, code: "Invalid Code" })
        .success,
    ).toBe(false);
    expect(
      mediaUploadMetadataSchema.safeParse({ ...valid, extra: "x" }).success,
    ).toBe(false);
  });
});

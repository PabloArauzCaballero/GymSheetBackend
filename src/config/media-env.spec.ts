import { z } from "zod";
import { mediaEnvironmentShape, refineMediaEnvironment } from "./media-env";

const schema = z
  .object({ NODE_ENV: z.string(), MEDIA_STORAGE_PROVIDER: z.string(), ...mediaEnvironmentShape })
  .superRefine((configuration, context) => refineMediaEnvironment(configuration, context));

describe("media environment", () => {
  it("demands an explicit user-content deletion declaration for MinIO in production", () => {
    const missing = schema.safeParse({ NODE_ENV: "production", MEDIA_STORAGE_PROVIDER: "minio" });
    expect(missing.success).toBe(false);
    expect(missing.error?.flatten().fieldErrors.MEDIA_USER_CONTENT_DELETABLE?.[0]).toContain("ADR-0017");
    expect(
      schema.safeParse({ NODE_ENV: "production", MEDIA_STORAGE_PROVIDER: "minio", MEDIA_USER_CONTENT_DELETABLE: "" })
        .success,
    ).toBe(false);
    for (const [raw, parsed] of [["true", true], ["false", false]] as const) {
      expect(
        schema.parse({ NODE_ENV: "production", MEDIA_STORAGE_PROVIDER: "minio", MEDIA_USER_CONTENT_DELETABLE: raw })
          .MEDIA_USER_CONTENT_DELETABLE,
      ).toBe(parsed);
    }
  });

  it("leaves it optional for local storage and outside production", () => {
    expect(schema.safeParse({ NODE_ENV: "production", MEDIA_STORAGE_PROVIDER: "local" }).success).toBe(true);
    expect(schema.parse({ NODE_ENV: "development", MEDIA_STORAGE_PROVIDER: "minio" }).MEDIA_USER_CONTENT_DELETABLE)
      .toBeUndefined();
  });

  it("accepts only true or false, not other boolean spellings", () => {
    expect(schema.safeParse({ NODE_ENV: "test", MEDIA_STORAGE_PROVIDER: "minio", MEDIA_USER_CONTENT_DELETABLE: "yes" }).success)
      .toBe(false);
  });
});

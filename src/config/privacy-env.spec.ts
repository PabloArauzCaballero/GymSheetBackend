import { z } from "zod";
import { privacyEnvironmentShape, refinePrivacyEnvironment } from "./privacy-env";

const schema = z
  .object({ NODE_ENV: z.string(), ...privacyEnvironmentShape })
  .superRefine((configuration, context) => refinePrivacyEnvironment(configuration, context));

describe("privacy environment", () => {
  it("requires an IP hash secret of at least 32 characters in production", () => {
    const missing = schema.safeParse({ NODE_ENV: "production" });
    expect(missing.success).toBe(false);
    expect(missing.error?.flatten().fieldErrors.IP_HASH_SECRET?.[0]).toContain("required in production");
    expect(schema.safeParse({ NODE_ENV: "production", IP_HASH_SECRET: "" }).success).toBe(false);
    expect(schema.safeParse({ NODE_ENV: "production", IP_HASH_SECRET: "short" }).success).toBe(false);
    expect(schema.safeParse({ NODE_ENV: "production", IP_HASH_SECRET: "x".repeat(32) }).success).toBe(true);
  });

  it("keeps the secret optional outside production, but never shorter than 32 characters", () => {
    for (const NODE_ENV of ["development", "test"]) {
      expect(schema.parse({ NODE_ENV }).IP_HASH_SECRET).toBeUndefined();
      expect(schema.parse({ NODE_ENV, IP_HASH_SECRET: "" }).IP_HASH_SECRET).toBeUndefined();
      expect(schema.safeParse({ NODE_ENV, IP_HASH_SECRET: "short" }).success).toBe(false);
    }
  });
});

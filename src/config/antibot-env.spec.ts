import { z } from "zod";
import { antibotEnvironmentShape, refineAntibotEnvironment } from "./antibot-env";

const schema = z
  .object({ NODE_ENV: z.string(), ...antibotEnvironmentShape })
  .superRefine((configuration, context) => refineAntibotEnvironment(configuration, context));

describe("antibot environment", () => {
  it("defaults to the layers that need no external account", () => {
    const parsed = schema.parse({ NODE_ENV: "development" });
    expect(parsed).toMatchObject({
      SIGNUP_TICKET_REQUIRED: true,
      SIGNUP_MIN_FILL_MS: 3000,
      TURNSTILE_FAIL_CLOSED: false,
      ATTESTATION_ENABLED: false,
      PASSWORD_BREACH_CHECK_ENABLED: false,
      SIGNUP_LIMIT_PER_IP_HOUR: 5,
      SIGNUP_LIMIT_PER_INSTALLATION_DAY: 3,
      SIGNUP_LIMIT_PER_EMAIL_DOMAIN_HOUR: 30,
    });
    expect(parsed.TURNSTILE_SECRET).toBeUndefined();
  });

  it("requires a ticket secret of at least 32 characters in production", () => {
    expect(schema.safeParse({ NODE_ENV: "production" }).success).toBe(false);
    expect(schema.safeParse({ NODE_ENV: "production", REGISTRATION_TICKET_SECRET: "short" }).success).toBe(false);
    expect(schema.safeParse({ NODE_ENV: "production", REGISTRATION_TICKET_SECRET: "x".repeat(32) }).success).toBe(true);
  });

  it("refuses to enable attestation without Play Integrity credentials", () => {
    expect(schema.safeParse({ NODE_ENV: "development", ATTESTATION_ENABLED: "true" }).success).toBe(false);
    expect(
      schema.safeParse({
        NODE_ENV: "development",
        ATTESTATION_ENABLED: "true",
        PLAY_INTEGRITY_PACKAGE_NAME: "com.gymsheet.app",
        PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: "{}",
      }).success,
    ).toBe(true);
  });
});

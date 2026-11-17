import { z } from "zod";
import { businessKycEnvironmentShape, refineBusinessKycEnvironment } from "./business-kyc-env";

const schema = z
  .object({ NODE_ENV: z.string(), ...businessKycEnvironmentShape })
  .superRefine((configuration, context) => refineBusinessKycEnvironment(configuration, context));

const KEY = "k".repeat(40);

describe("business KYC environment (ADR-0021)", () => {
  it("refuses to boot in production without KYC_ENCRYPTION_KEY, empty included", () => {
    for (const value of [undefined, ""]) {
      const result = schema.safeParse({ NODE_ENV: "production", KYC_ENCRYPTION_KEY: value });
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.KYC_ENCRYPTION_KEY?.[0]).toContain("required in production");
    }
    expect(schema.safeParse({ NODE_ENV: "production", KYC_ENCRYPTION_KEY: "short" }).success).toBe(false);
    expect(schema.safeParse({ NODE_ENV: "production", KYC_ENCRYPTION_KEY: KEY }).success).toBe(true);
  });

  it("leaves the key optional outside production and defaults the budget, SLAs and the disabled OTP provider", () => {
    expect(schema.parse({ NODE_ENV: "development" })).toMatchObject({
      KYC_PIPELINE_BUDGET_MS: 2000,
      KYC_CHECK_STATEMENT_TIMEOUT_MS: 500,
      BUSINESS_KYC_REVIEW_SLA_HOURS: 24,
      BUSINESS_KYC_POST_REVIEW_SLA_HOURS: 72,
      BUSINESS_PHONE_OTP_PROVIDER: "disabled",
    });
  });

  it("defaults the KYC retention to the proposal of plan §2.14 and refuses a records period under one year (ADR-0028)", () => {
    expect(schema.parse({ NODE_ENV: "development" })).toMatchObject({
      KYC_RETENTION_ABANDONED_DRAFT_DAYS: 30,
      KYC_RETENTION_REJECTED_DAYS: 30,
      KYC_RETENTION_SELFIE_DAYS: 30,
      KYC_RETENTION_SUPERSEDED_DAYS: 30,
      KYC_RETENTION_CLOSED_ACCOUNT_DAYS: 180,
      KYC_RETENTION_PHONE_CODE_DAYS: 1,
      KYC_RETENTION_RECORDS_DAYS: 1825,
    });
    expect(schema.parse({ NODE_ENV: "development", KYC_RETENTION_CLOSED_ACCOUNT_DAYS: "365" }).KYC_RETENTION_CLOSED_ACCOUNT_DAYS).toBe(365);
    expect(schema.safeParse({ NODE_ENV: "development", KYC_RETENTION_RECORDS_DAYS: "30" }).success).toBe(false);
  });

  it("whatsapp-cloud needs its token, phone number id and template", () => {
    const base = { NODE_ENV: "development", BUSINESS_PHONE_OTP_PROVIDER: "whatsapp-cloud" };
    expect(schema.safeParse(base).success).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        WHATSAPP_CLOUD_ACCESS_TOKEN: "token-0123456789-abcdefghij",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_CLOUD_OTP_TEMPLATE: "repp_codigo",
      }).success,
    ).toBe(true);
  });
});

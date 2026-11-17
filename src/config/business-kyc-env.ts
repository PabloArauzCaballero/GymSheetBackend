import { z } from "zod";

/**
 * Environment of the business KYC (ADR-0021).
 *
 * Kept apart from `env.ts` so the rule reads as one unit; the main schema only
 * spreads it. It must not import `env.ts`: that file imports this one.
 */
const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

export const PHONE_OTP_PROVIDERS = ["disabled", "whatsapp-cloud"] as const;
export type PhoneOtpProviderName = (typeof PHONE_OTP_PROVIDERS)[number];

export const businessKycEnvironmentShape = {
  /**
   * Key of every KYC ciphertext (NIT, CI, phone, documents). Its own key on
   * purpose: never derived from the JWT secrets. Mandatory in production (the
   * API refuses to boot without it); unset elsewhere = the KYC answers 503.
   * Losing it loses every stored KYC document.
   */
  KYC_ENCRYPTION_KEY: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
  /** Whole budget of the automatic checks of one submission; past it, the rest are ERROR (→ IN_REVIEW). */
  KYC_PIPELINE_BUDGET_MS: z.coerce.number().int().min(200).max(10_000).default(2000),
  /** `statement_timeout` of every query of the automatic checks. */
  KYC_CHECK_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(50).max(5000).default(500),
  /** REPP review queue SLA, in business hours (Mon–Fri in BUSINESS_TIME_ZONE). */
  BUSINESS_KYC_REVIEW_SLA_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  /** Post-review of an automatic approval, in calendar hours. */
  BUSINESS_KYC_POST_REVIEW_SLA_HOURS: z.coerce.number().int().min(1).max(2160).default(72),
  /**
   * Who delivers the phone OTP. `disabled`: no code is sent and the
   * PHONE_VERIFIED check fails, so the submission goes to REPP review (it is
   * never approved automatically). `whatsapp-cloud`: Meta WhatsApp Business
   * Cloud API, authentication template.
   */
  BUSINESS_PHONE_OTP_PROVIDER: z.enum(PHONE_OTP_PROVIDERS).default("disabled"),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.preprocess(emptyAsUndefined, z.string().trim().min(20).optional()),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.preprocess(emptyAsUndefined, z.string().trim().regex(/^\d{5,20}$/u).optional()),
  WHATSAPP_CLOUD_OTP_TEMPLATE: z.preprocess(emptyAsUndefined, z.string().trim().regex(/^[a-z0-9_]{1,512}$/u).optional()),
  WHATSAPP_CLOUD_TEMPLATE_LANGUAGE: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/u).default("es"),
  WHATSAPP_CLOUD_API_VERSION: z.string().trim().regex(/^v\d{1,3}\.\d$/u).default("v21.0"),
  /**
   * KYC retention, in days (plan §2.14, ADR-0028). Proposed values PENDING the
   * lawyer (Q5): an abandoned DRAFT and a REJECTED attempt lose documents and
   * encrypted data after 30; the selfie of a decided attempt after 30; an
   * approved version replaced by a newer one after 30; a closed business its
   * documents and identity data after 180; decisions, checks, history and
   * fingerprints (no image, no datum in clear) live 5 years after closure.
   */
  KYC_RETENTION_ABANDONED_DRAFT_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  KYC_RETENTION_REJECTED_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  KYC_RETENTION_SELFIE_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  KYC_RETENTION_SUPERSEDED_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  KYC_RETENTION_CLOSED_ACCOUNT_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  KYC_RETENTION_PHONE_CODE_DAYS: z.coerce.number().int().min(1).max(365).default(1),
  KYC_RETENTION_RECORDS_DAYS: z.coerce.number().int().min(365).max(7300).default(1825),
};

type BusinessKycEnvironment = {
  NODE_ENV: string;
  KYC_ENCRYPTION_KEY?: string;
  BUSINESS_PHONE_OTP_PROVIDER: PhoneOtpProviderName;
  WHATSAPP_CLOUD_ACCESS_TOKEN?: string;
  WHATSAPP_CLOUD_PHONE_NUMBER_ID?: string;
  WHATSAPP_CLOUD_OTP_TEMPLATE?: string;
};

export function refineBusinessKycEnvironment(configuration: BusinessKycEnvironment, context: z.RefinementCtx): void {
  if (configuration.NODE_ENV === "production" && !configuration.KYC_ENCRYPTION_KEY)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["KYC_ENCRYPTION_KEY"],
      message: "KYC_ENCRYPTION_KEY (>= 32 chars) is required in production: it encrypts every KYC datum and document.",
    });
  if (
    configuration.BUSINESS_PHONE_OTP_PROVIDER === "whatsapp-cloud" &&
    (!configuration.WHATSAPP_CLOUD_ACCESS_TOKEN || !configuration.WHATSAPP_CLOUD_PHONE_NUMBER_ID || !configuration.WHATSAPP_CLOUD_OTP_TEMPLATE)
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BUSINESS_PHONE_OTP_PROVIDER"],
      message: "whatsapp-cloud requires WHATSAPP_CLOUD_ACCESS_TOKEN, WHATSAPP_CLOUD_PHONE_NUMBER_ID and WHATSAPP_CLOUD_OTP_TEMPLATE.",
    });
}

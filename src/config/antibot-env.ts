import { z } from "zod";

/**
 * Environment of the signup anti-automation layer (ADR-0013).
 *
 * Kept apart from `env.ts` so the layer's flags read as one unit, and so the
 * main schema only spreads it. It must not import `env.ts`: that file imports
 * this one, and the cycle would evaluate these schemas before their helpers.
 */
const booleanFlag = z.preprocess((rawValue) => {
  if (typeof rawValue !== "string") return rawValue;
  const normalizedValue = rawValue.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) return true;
  if (["false", "0", "no", "off"].includes(normalizedValue)) return false;
  return rawValue;
}, z.boolean());

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

const domainListSchema = z.string().transform((rawValue) =>
  rawValue
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

export const antibotEnvironmentShape = {
  /** HMAC key of form tickets and attestation nonces. Mandatory in production. */
  REGISTRATION_TICKET_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
  /** `false` lets clients without a ticket through (risk raised); for a deliberate cut-over only. */
  SIGNUP_TICKET_REQUIRED: booleanFlag.default(true),
  /** Minimum server-measured time between ticket issue and submit. */
  SIGNUP_MIN_FILL_MS: z.coerce.number().int().min(0).max(600000).default(3000),
  /** Cloudflare Turnstile secret. Unset = the Turnstile layer is off. */
  TURNSTILE_SECRET: z.preprocess(emptyAsUndefined, z.string().trim().min(1).optional()),
  /** `true` rejects signups while Cloudflare is unreachable; default only raises risk. */
  TURNSTILE_FAIL_CLOSED: booleanFlag.default(false),
  /** Enforces mobile app attestation (Play Integrity) on IOS/ANDROID signups. */
  ATTESTATION_ENABLED: booleanFlag.default(false),
  PLAY_INTEGRITY_PACKAGE_NAME: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .trim()
      .regex(/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/)
      .optional(),
  ),
  /** Service-account key JSON (one line) with the Play Integrity API enabled. */
  PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: z.preprocess(
    emptyAsUndefined,
    z.string().trim().min(1).optional(),
  ),
  SIGNUP_LIMIT_PER_IP_HOUR: z.coerce.number().int().min(1).max(100000).default(5),
  SIGNUP_LIMIT_PER_INSTALLATION_DAY: z.coerce.number().int().min(1).max(100000).default(3),
  SIGNUP_LIMIT_PER_EMAIL_DOMAIN_HOUR: z.coerce.number().int().min(1).max(100000).default(30),
  /** Large mailbox providers exempt from the per-domain velocity limit. */
  SIGNUP_EMAIL_DOMAIN_ALLOWLIST: domainListSchema.default(
    "gmail.com,googlemail.com,outlook.com,hotmail.com,live.com,yahoo.com,icloud.com,me.com,proton.me,protonmail.com",
  ),
  /** k-anonymity lookup against Have I Been Pwned; only raises risk. */
  PASSWORD_BREACH_CHECK_ENABLED: booleanFlag.default(false),
  /** Timeout of every outbound anti-bot call (Turnstile, Google, HIBP). */
  ANTIBOT_HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(15000).default(3000),
};

type AntibotEnvironment = {
  NODE_ENV: string;
  REGISTRATION_TICKET_SECRET?: string;
  ATTESTATION_ENABLED: boolean;
  PLAY_INTEGRITY_PACKAGE_NAME?: string;
  PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON?: string;
};

export function refineAntibotEnvironment(
  configuration: AntibotEnvironment,
  context: z.RefinementCtx,
): void {
  if (configuration.NODE_ENV === "production" && !configuration.REGISTRATION_TICKET_SECRET)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["REGISTRATION_TICKET_SECRET"],
      message: "REGISTRATION_TICKET_SECRET (>= 32 chars) is required in production.",
    });
  if (
    configuration.ATTESTATION_ENABLED &&
    (!configuration.PLAY_INTEGRITY_PACKAGE_NAME ||
      !configuration.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON)
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ATTESTATION_ENABLED"],
      message:
        "ATTESTATION_ENABLED requires PLAY_INTEGRITY_PACKAGE_NAME and PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON.",
    });
}

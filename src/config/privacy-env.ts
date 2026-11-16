import { z } from "zod";

/**
 * Environment of the privacy pepper (ADR-0014, ADR-0015).
 *
 * Kept apart from `env.ts` so the rule reads as one unit; the main schema only
 * spreads it. It must not import `env.ts`: that file imports this one.
 */
const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

export const privacyEnvironmentShape = {
  /**
   * Key of every HMAC of a client IP and of the email kept for a sanctioned
   * closed account. Mandatory in production: without it no IP evidence and no
   * ban-evasion record is stored. Optional elsewhere (unset = none stored).
   */
  IP_HASH_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
};

type PrivacyEnvironment = { NODE_ENV: string; IP_HASH_SECRET?: string };

export function refinePrivacyEnvironment(configuration: PrivacyEnvironment, context: z.RefinementCtx): void {
  if (configuration.NODE_ENV === "production" && !configuration.IP_HASH_SECRET)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["IP_HASH_SECRET"],
      message:
        "IP_HASH_SECRET (>= 32 chars) is required in production: it keys the IP and closed-account email HMACs.",
    });
}

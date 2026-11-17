import { z } from "zod";

/**
 * Environment of third-party sign-in (Google / Apple).
 *
 * Kept apart from `env.ts` so the flags read as one unit; the main schema only
 * spreads it. It must not import `env.ts`: that file imports this one.
 * Both providers ship OFF: until real client ids exist the routes answer 404.
 */
const booleanFlag = z.preprocess((rawValue) => {
  if (typeof rawValue !== "string") return rawValue;
  const normalizedValue = rawValue.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) return true;
  if (["false", "0", "no", "off"].includes(normalizedValue)) return false;
  return rawValue;
}, z.boolean());

const clientIdListSchema = z.string().transform((rawValue) =>
  rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

export const identityEnvironmentShape = {
  AUTH_GOOGLE_ENABLED: booleanFlag.default(false),
  /** OAuth client ids accepted as `aud` (web, iOS and Android clients). */
  GOOGLE_CLIENT_IDS: clientIdListSchema.default(""),
  AUTH_APPLE_ENABLED: booleanFlag.default(false),
  /** Bundle id / Services id accepted as `aud`. */
  APPLE_CLIENT_IDS: clientIdListSchema.default(""),
};

type IdentityEnvironment = {
  AUTH_GOOGLE_ENABLED: boolean;
  GOOGLE_CLIENT_IDS: string[];
  AUTH_APPLE_ENABLED: boolean;
  APPLE_CLIENT_IDS: string[];
};

export function refineIdentityEnvironment(
  configuration: IdentityEnvironment,
  context: z.RefinementCtx,
): void {
  if (configuration.AUTH_GOOGLE_ENABLED && configuration.GOOGLE_CLIENT_IDS.length === 0)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GOOGLE_CLIENT_IDS"],
      message: "AUTH_GOOGLE_ENABLED requires at least one GOOGLE_CLIENT_IDS entry.",
    });
  if (configuration.AUTH_APPLE_ENABLED && configuration.APPLE_CLIENT_IDS.length === 0)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["APPLE_CLIENT_IDS"],
      message: "AUTH_APPLE_ENABLED requires at least one APPLE_CLIENT_IDS entry.",
    });
}

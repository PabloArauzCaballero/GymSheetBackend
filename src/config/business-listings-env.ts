import { z } from "zod";

/**
 * Environment of the business listings' publication checks (ADR-0022).
 * Kept apart from `env.ts`, which only spreads it; it must not import `env.ts`.
 */
export const businessListingsEnvironmentShape = {
  /** Price band of a listing in BOB: outside it the listing is HELD for REPP, not published. */
  LISTING_PRICE_MIN_BOB: z.coerce.number().min(0).max(1_000_000).default(1),
  LISTING_PRICE_MAX_BOB: z.coerce.number().min(1).max(10_000_000).default(50_000),
  /** A price this many times above (or below) the median of its offer kind is HELD. */
  LISTING_PRICE_OUTLIER_FACTOR: z.coerce.number().min(2).max(100).default(5),
  /** Below this many live listings of a kind there is no meaningful median, so no outlier check. */
  LISTING_PRICE_MEDIAN_MIN_SAMPLES: z.coerce.number().int().min(3).max(1000).default(5),
};

type BusinessListingsEnvironment = { LISTING_PRICE_MIN_BOB: number; LISTING_PRICE_MAX_BOB: number };

export function refineBusinessListingsEnvironment(configuration: BusinessListingsEnvironment, context: z.RefinementCtx): void {
  if (configuration.LISTING_PRICE_MIN_BOB >= configuration.LISTING_PRICE_MAX_BOB)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LISTING_PRICE_MIN_BOB"],
      message: "LISTING_PRICE_MIN_BOB must be lower than LISTING_PRICE_MAX_BOB.",
    });
}

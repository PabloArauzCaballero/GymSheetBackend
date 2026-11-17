import { z } from "zod";

/**
 * Environment of the marketplace orders (ADR-0024). Kept apart from `env.ts`,
 * which only spreads it; it must not import `env.ts`.
 */
export const businessOrdersEnvironmentShape = {
  /** A QR order not paid (no receipt) within this many hours expires and frees its stock. */
  ORDER_PAYMENT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  /** A cash order the business has not confirmed within this many hours expires and frees its stock. */
  ORDER_CASH_TTL_HOURS: z.coerce.number().int().min(1).max(336).default(72),
  /** Reminders to the business about a receipt waiting for its decision, in hours since it was sent. */
  ORDER_VERIFICATION_FIRST_REMINDER_HOURS: z.coerce.number().int().min(1).max(336).default(24),
  ORDER_VERIFICATION_SECOND_REMINDER_HOURS: z.coerce.number().int().min(2).max(672).default(48),
  /** Units of a product in one order. Only products take more than one. */
  ORDER_MAX_QUANTITY: z.coerce.number().int().min(1).max(1000).default(20),
  /** Orders a person may hold open (waiting for payment or for the business) at once. */
  ORDER_OPEN_MAX_PER_PERSON: z.coerce.number().int().min(1).max(100).default(5),
  /** Receipts a buyer may send for one order (the first one and the resends after a rejection). */
  ORDER_RECEIPT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  /** `worker:orders-maintenance`: pause between idle passes and orders per pass. */
  ORDERS_MAINTENANCE_INTERVAL_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  ORDERS_MAINTENANCE_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(200),
};

type BusinessOrdersEnvironment = { ORDER_VERIFICATION_FIRST_REMINDER_HOURS: number; ORDER_VERIFICATION_SECOND_REMINDER_HOURS: number };

export function refineBusinessOrdersEnvironment(configuration: BusinessOrdersEnvironment, context: z.RefinementCtx): void {
  if (configuration.ORDER_VERIFICATION_FIRST_REMINDER_HOURS >= configuration.ORDER_VERIFICATION_SECOND_REMINDER_HOURS)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ORDER_VERIFICATION_FIRST_REMINDER_HOURS"],
      message: "ORDER_VERIFICATION_FIRST_REMINDER_HOURS must be lower than ORDER_VERIFICATION_SECOND_REMINDER_HOURS.",
    });
}

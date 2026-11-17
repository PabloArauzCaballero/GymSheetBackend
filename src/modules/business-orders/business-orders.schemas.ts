import { z } from 'zod';
import { ORDER_METHODS, REJECTION_CODES } from './order.catalog';

/**
 * The buyer names the listing, how many units and how to pay. Nothing about
 * money travels in the body: the price comes from the listing (strict schema,
 * so `amount`, `price` or `currency` are a 400, never a silent ignore).
 */
export const createOrderSchema = z
  .object({
    listingId: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000).default(1),
    method: z.enum(ORDER_METHODS).default('QR'),
    note: z.string().trim().max(500).optional(),
    /**
     * A gym membership needs the buyer's SOCIO affiliation at that gym (ADR-0026):
     * without one, the checkout asks the location and the last three CI digits
     * and the order creates the REQUESTED affiliation in the same transaction.
     * `switchGym` confirms a «cambio de gimnasio» (ADR-0025 §7).
     */
    affiliation: z
      .object({
        locationId: z.string().uuid(),
        ciLast3: z.string().regex(/^[0-9]{3}$/u, 'Escribe los últimos 3 dígitos de tu CI.'),
        switchGym: z.boolean().default(false),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** «También confirmo que es socio» is checked by default: the business unchecks it to confirm only the payment. */
export const confirmOrderSchema = z.object({ alsoConfirmAffiliation: z.boolean().default(true) }).strict().default({});
export type ConfirmOrderInput = z.infer<typeof confirmOrderSchema>;

/** Optional text sent with the receipt (multipart field), e.g. the bank's operation number. */
export const receiptFieldsSchema = z
  .object({ reference: z.string().trim().min(1).max(100).optional() })
  .strict();
export type ReceiptFields = z.infer<typeof receiptFieldsSchema>;

export const rejectOrderSchema = z
  .object({
    reasonCode: z.enum(REJECTION_CODES),
    note: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;

export const ORDER_STATUSES = ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED'] as const;

/** Keyset page: `cursor` is opaque (base64url of the sort key and id). */
export const orderListQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));

/** The business's payment data. The QR is a file of its own (multipart), never a URL. */
export const paymentConfigSchema = z
  .object({
    bankName: z.string().trim().min(2).max(100),
    accountHolderName: z.string().trim().min(2).max(180),
    accountNumber: optionalText(100),
    aliasOrPhone: optionalText(100),
    instructions: optionalText(2000),
    acceptsCash: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict();
export type PaymentConfigInput = z.infer<typeof paymentConfigSchema>;

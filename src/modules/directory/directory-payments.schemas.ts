import { z } from 'zod';

export const entityPaymentConfigSchema = z.object({
  bankName: z.string().trim().min(2).max(100),
  accountHolderName: z.string().trim().min(2).max(180),
  taxId: z.string().trim().min(3).max(50),
  accountNumber: z.string().trim().min(4).max(100),
  aliasOrPhone: z.string().trim().max(100).nullable().optional(),
  qrImageUrl: z.string().trim().min(5),
  qrPayload: z.string().trim().nullable().optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type EntityPaymentConfigInput = z.infer<typeof entityPaymentConfigSchema>;

export const entityPlanTypeEnum = z.enum(['MEMBERSHIP_PLAN', 'PASS', 'SERVICE', 'PRODUCT']);
export const entityPlanStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);

export const createEntityPlanSchema = z.object({
  type: entityPlanTypeEnum.optional().default('MEMBERSHIP_PLAN'),
  name: z.string().trim().min(2).max(180),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(180)
    .regex(/^[a-z0-9-]+$/, 'El slug solo puede contener minúsculas, números y guiones')
    .optional(),
  description: z.string().trim().min(5).max(5000),
  benefits: z.array(z.string().trim().min(1)).optional().default([]),
  durationDays: z.number().int().min(1).max(3650).nullable().optional(),
  price: z.number().nonnegative(),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/).optional().default('USD'),
  displayOrder: z.number().int().optional().default(0),
  mediaUrls: z.array(z.string().trim()).optional().default([]),
  metadata: z.record(z.unknown()).optional().default({}),
  initialReason: z.string().trim().min(3).max(500).optional().default('Precio de lanzamiento inicial'),
});
export type CreateEntityPlanInput = z.input<typeof createEntityPlanSchema>;

export const updateEntityPlanSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().min(5).max(5000).optional(),
  benefits: z.array(z.string().trim().min(1)).optional(),
  durationDays: z.number().int().min(1).max(3650).nullable().optional(),
  status: entityPlanStatusEnum.optional(),
  displayOrder: z.number().int().optional(),
  mediaUrls: z.array(z.string().trim()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateEntityPlanInput = z.infer<typeof updateEntityPlanSchema>;

export const updatePlanPriceSchema = z.object({
  newPrice: z.number().nonnegative(),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/).optional(),
  reason: z.string().trim().min(5).max(500),
  isPromotional: z.boolean().optional().default(false),
});
export type UpdatePlanPriceInput = z.input<typeof updatePlanPriceSchema>;

export const createPaymentOrderSchema = z.object({
  planId: z.string().uuid(),
  athleteNotes: z.string().trim().max(500).nullable().optional(),
});
export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;

export const submitReceiptSchema = z.object({
  receiptUrl: z.string().trim().min(5),
  receiptStorageKey: z.string().trim().nullable().optional(),
  receiptReference: z.string().trim().max(100).nullable().optional(),
  athleteNotes: z.string().trim().max(500).nullable().optional(),
});
export type SubmitReceiptInput = z.infer<typeof submitReceiptSchema>;

export const rejectPaymentOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RejectPaymentOrderInput = z.infer<typeof rejectPaymentOrderSchema>;

export const paymentOrderStatusEnum = z.enum([
  'PENDING_PAYMENT',
  'PENDING_VERIFICATION',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
]);

export const paymentOrderListQuerySchema = z.object({
  status: paymentOrderStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaymentOrderListQuery = z.infer<typeof paymentOrderListQuerySchema>;

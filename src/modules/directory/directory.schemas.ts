import { z } from 'zod';

export const entityTypeEnum = z.enum([
  'GYM',
  'COACH',
  'CENTER',
  'STORE',
  'SERVICE_PROVIDER',
]);
export type EntityType = z.infer<typeof entityTypeEnum>;

export const publicDirectoryFilterQuerySchema = z.object({
  category_path: z.string().trim().max(120).optional(),
  type: entityTypeEnum.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  rating_min: z.coerce.number().min(1).max(5).optional(),
  verified_only: z.coerce.boolean().optional(),
  city: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type PublicDirectoryFilterQuery = z.infer<typeof publicDirectoryFilterQuerySchema>;

export const listReviewsQuerySchema = z.object({
  sort_by: z.enum(['helpful', 'recent', 'highest', 'lowest']).default('helpful'),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const createReviewBodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(2000),
  experience_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha YYYY-MM-DD').optional(),
});
export type CreateReviewBody = z.infer<typeof createReviewBodySchema>;

export const updateReviewBodySchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().trim().min(3).max(120).optional(),
  body: z.string().trim().min(10).max(2000).optional(),
  experience_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha YYYY-MM-DD').optional(),
});
export type UpdateReviewBody = z.infer<typeof updateReviewBodySchema>;

export const createReviewReplyBodySchema = z.object({
  reply_text: z.string().trim().min(5).max(1500),
});
export type CreateReviewReplyBody = z.infer<typeof createReviewReplyBodySchema>;

export const createEntityBodySchema = z.object({
  name: z.string().trim().min(2).max(180),
  entity_type: entityTypeEnum,
  headline: z.string().trim().max(255).optional(),
  description: z.string().trim().min(10),
  primary_category_id: z.string().uuid(),
  secondary_category_ids: z.array(z.string().uuid()).optional(),
  tenant_id: z.string().trim().max(60).optional(),
  user_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  logo_url: z.string().url().optional(),
  cover_url: z.string().url().optional(),
  gallery: z.array(z.string().url()).optional(),
  is_online_only: z.boolean().default(false),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  contact_info: z.record(z.string(), z.string()).optional(),
  business_hours: z.record(z.string(), z.object({ open: z.string(), close: z.string() })).optional(),
  is_verified: z.boolean().default(false),
});
export type CreateEntityBody = z.infer<typeof createEntityBodySchema>;

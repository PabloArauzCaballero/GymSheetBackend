import { z } from 'zod';

export const entityPlanTypeEnum = z.enum(['MEMBERSHIP_PLAN', 'PASS', 'SERVICE', 'PRODUCT']);

/** Listado público del marketplace: tipo opcional y página acotada. */
export const marketplacePlanListQuerySchema = z.object({
  type: entityPlanTypeEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MarketplacePlanListQuery = z.infer<typeof marketplacePlanListQuerySchema>;

import { z } from "zod";

export const signupAuditQuerySchema = z.object({
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SignupAuditQueryInput = z.infer<typeof signupAuditQuerySchema>;

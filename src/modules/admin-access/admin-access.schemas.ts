import { z } from 'zod';

export const grantPermissionSchema = z
  .object({
    permissionKey: z.string().trim().min(1).max(80),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .transform((input) => ({
    permissionKey: input.permissionKey,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  }));

export type GrantPermissionInput = z.infer<typeof grantPermissionSchema>;

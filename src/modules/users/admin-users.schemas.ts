import { z } from 'zod';
import { UserRole, UserStatus } from '../../common/enums/domain.enums';

/**
 * REPP's account search (`GET /admin/users`). Same query as the retired
 * `admin/membership/users`, plus `status`. Strict: an unknown parameter is a
 * 400. `roles` travels as one comma-separated string (`?roles=CLIENTE`):
 * filtering in the browser loses whoever falls outside the first page.
 */
export const adminUserSearchSchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .transform((value) => value ?? null),
    roles: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .transform((value) =>
        value
          .split(',')
          .map((part) => part.trim().toUpperCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.nativeEnum(UserRole)).min(1).max(8))
      .optional()
      .transform((value) => value ?? null),
    status: z.nativeEnum(UserStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type AdminUserSearchInput = z.infer<typeof adminUserSearchSchema>;

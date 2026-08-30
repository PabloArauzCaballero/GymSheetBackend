import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/** Mirrors `@Roles()`: adds a fine-grained permission floor on top of the coarse role check. */
export const RequirePermission = (...permissions: string[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(PERMISSIONS_KEY, permissions);

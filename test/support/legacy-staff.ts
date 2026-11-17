import type { E2eApp } from './e2e-app';

export type LegacyStaffRole = 'ADMIN' | 'FRONT_DESK' | 'COACH';
export const LEGACY_STAFF_ROLES: readonly LegacyStaffRole[] = ['ADMIN', 'FRONT_DESK', 'COACH'];

/**
 * A legacy gym staff account: since franja 7a (ADR-0019) its role grants no
 * power. `keys` gives it admin permission grants, which open nothing either:
 * every `admin/*` route requires REPP's `SYSTEM_ADMIN`.
 */
export async function legacyGymStaff(
  e2e: E2eApp,
  label: string,
  role: LegacyStaffRole,
  options: { tenantId?: string; keys?: readonly string[] } = {},
): Promise<{ token: string; id: string }> {
  const account = await e2e.register(label);
  await e2e.promote(account.id, role);
  if (options.tenantId) {
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :tenantId WHERE id = :id', { tenantId: options.tenantId, id: account.id });
  }
  for (const key of options.keys ?? []) {
    await e2e.sql(
      `INSERT INTO admin.user_permissions (id, user_id, permission_key) VALUES (gen_random_uuid(), :id, :key)`,
      { id: account.id, key },
    );
  }
  return account;
}

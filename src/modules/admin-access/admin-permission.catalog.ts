/**
 * Keys the web still uses to gate buttons of REPP's console. Since franja 7d
 * (ADR-0029) there is no grant table: a `SYSTEM_ADMIN` holds every key and
 * nobody else reaches `admin/*`. Kept only for `GET /admin/permissions/me`.
 */
export const ADMIN_PERMISSION_KEYS = [
  'catalog:read',
  'catalog:write',
  'qa:read',
  'qa:run',
  'qa:admin',
  'data-loader:run',
  'data-loader:admin',
  'files:read',
  'files:download',
  'support:read',
  'support:respond',
  'users:read',
  'users:manage',
  'users:danger',
  'analytics:read',
  'analytics:admin',
  'artifacts:read',
  'artifacts:admin',
  'admin-access:manage',
] as const;

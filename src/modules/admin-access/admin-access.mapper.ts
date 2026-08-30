import { AdminPermissionDefinition } from './admin-permission.catalog';
import { AdminUserPermissionModel } from './admin-user-permission.model';

export function mapAdminPermissionCatalog(catalog: readonly AdminPermissionDefinition[]) {
  return catalog.map((permission) => ({
    key: permission.key,
    label: permission.label,
    description: permission.description,
    domain: permission.domain,
  }));
}

export function mapAdminUserPermission(grant: AdminUserPermissionModel) {
  return {
    id: grant.id,
    userId: grant.userId,
    permissionKey: grant.permissionKey,
    grantedByUserId: grant.grantedByUserId,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
  };
}

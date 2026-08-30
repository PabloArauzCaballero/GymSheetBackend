import { Injectable, NotFoundException } from '@nestjs/common';
import { ADMIN_PERMISSION_CATALOG } from './admin-permission.catalog';
import { mapAdminPermissionCatalog, mapAdminUserPermission } from './admin-access.mapper';
import { AdminPermissionsRepository } from './admin-permissions.repository';
import { GrantPermissionInput } from './admin-access.schemas';

@Injectable()
export class AdminPermissionsService {
  private readonly knownPermissionKeys = new Set<string>(
    ADMIN_PERMISSION_CATALOG.map((permission) => permission.key),
  );

  constructor(private readonly repository: AdminPermissionsRepository) {}

  async getPermissionKeysForUser(userId: string): Promise<string[]> {
    const grants = await this.repository.findActiveGrantsForUser(userId);
    return grants.map((grant) => grant.permissionKey);
  }

  listCatalog() {
    return mapAdminPermissionCatalog(ADMIN_PERMISSION_CATALOG);
  }

  async listGrantsForUser(userId: string) {
    const grants = await this.repository.findGrantsForUser(userId);
    return grants.map(mapAdminUserPermission);
  }

  async grant(targetUserId: string, input: GrantPermissionInput, grantedByUserId: string) {
    if (!this.knownPermissionKeys.has(input.permissionKey)) {
      throw new NotFoundException('Permiso no reconocido.');
    }
    const grant = await this.repository.grant(
      targetUserId,
      input.permissionKey,
      grantedByUserId,
      input.expiresAt,
    );
    return mapAdminUserPermission(grant);
  }

  async revoke(targetUserId: string, permissionKey: string): Promise<void> {
    const revoked = await this.repository.revoke(targetUserId, permissionKey);
    if (!revoked) {
      throw new NotFoundException('El usuario no tiene ese permiso asignado.');
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { isAccountInScope } from '../../common/tenancy/tenant-scope';
import { UsersRepository } from '../users/users.repository';
import { ADMIN_PERMISSION_CATALOG } from './admin-permission.catalog';
import { mapAdminPermissionCatalog, mapAdminUserPermission } from './admin-access.mapper';
import { AdminPermissionsRepository } from './admin-permissions.repository';
import { GrantPermissionInput } from './admin-access.schemas';

@Injectable()
export class AdminPermissionsService {
  private readonly knownPermissionKeys = new Set<string>(
    ADMIN_PERMISSION_CATALOG.map((permission) => permission.key),
  );

  constructor(
    private readonly repository: AdminPermissionsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async getPermissionKeysForUser(userId: string): Promise<string[]> {
    const grants = await this.repository.findActiveGrantsForUser(userId);
    return grants.map((grant) => grant.permissionKey);
  }

  listCatalog() {
    return mapAdminPermissionCatalog(ADMIN_PERMISSION_CATALOG);
  }

  async listGrantsForUser(userId: string, tenantScope: string | null) {
    await this.requireUserInScope(userId, tenantScope);
    const grants = await this.repository.findGrantsForUser(userId);
    return grants.map(mapAdminUserPermission);
  }

  async grant(
    targetUserId: string,
    input: GrantPermissionInput,
    grantedByUserId: string,
    tenantScope: string | null,
  ) {
    if (!this.knownPermissionKeys.has(input.permissionKey)) {
      throw new NotFoundException('Permiso no reconocido.');
    }
    await this.requireUserInScope(targetUserId, tenantScope);
    const grant = await this.repository.grant(
      targetUserId,
      input.permissionKey,
      grantedByUserId,
      input.expiresAt,
    );
    return mapAdminUserPermission(grant);
  }

  async revoke(
    targetUserId: string,
    permissionKey: string,
    tenantScope: string | null,
  ): Promise<void> {
    await this.requireUserInScope(targetUserId, tenantScope);
    const revoked = await this.repository.revoke(targetUserId, permissionKey);
    if (!revoked) {
      throw new NotFoundException('El usuario no tiene ese permiso asignado.');
    }
  }

  /**
   * El destinatario de una concesión tiene que estar en el alcance de quien la
   * concede.
   *
   * Sin esto, el identificador de usuario de la ruta era una llave: un
   * administrador podía conceder permisos de administración a una cuenta de
   * OTRO gimnasio, que no es una fuga de datos sino una escalada de privilegios
   * que sobrevive a la sesión.
   *
   * Fuera de alcance responde 404 y no 403: el administrador no tiene forma de
   * saber que esa cuenta existe, y distinguir «no existe» de «no es tuya» le
   * confirmaría identificadores ajenos uno a uno.
   */
  private async requireUserInScope(
    userId: string,
    tenantScope: string | null,
  ): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user || !isAccountInScope(user, tenantScope)) {
      throw new NotFoundException('Usuario no encontrado.');
    }
  }
}

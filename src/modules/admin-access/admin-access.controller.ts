import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminPermissionKey } from './admin-permission.catalog';
import { AdminPermissionsService } from './admin-permissions.service';
import { GrantPermissionInput, grantPermissionSchema } from './admin-access.schemas';

// Deliberately not under `admin/access/*`: that prefix is already the physical
// access-control module (devices/credentials). This is unrelated — granular
// admin RBAC permissions — so it gets its own `admin/permissions` namespace.
@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller('admin/permissions')
export class AdminAccessController {
  constructor(private readonly adminPermissionsService: AdminPermissionsService) {}

  @Get('me')
  async getMine(@CurrentUser() user: AuthenticatedUser) {
    const permissionKeys = await this.adminPermissionsService.getPermissionKeysForUser(user.id);
    return { permissionKeys };
  }

  @Get('catalog')
  @RequirePermission(AdminPermissionKey.ADMIN_ACCESS_MANAGE)
  listCatalog() {
    return this.adminPermissionsService.listCatalog();
  }

  @Get(':userId')
  @RequirePermission(AdminPermissionKey.ADMIN_ACCESS_MANAGE)
  listForUser(
    @Param('userId', UuidParamPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.adminPermissionsService.listGrantsForUser(userId, actor.tenantScope);
  }

  @Post(':userId')
  @RequirePermission(AdminPermissionKey.ADMIN_ACCESS_MANAGE)
  grant(
    @Param('userId', UuidParamPipe) userId: string,
    @Body(new ZodValidationPipe(grantPermissionSchema)) input: GrantPermissionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.adminPermissionsService.grant(
      userId,
      input,
      actor.id,
      actor.tenantScope,
    );
  }

  @Delete(':userId/:permissionKey')
  @RequirePermission(AdminPermissionKey.ADMIN_ACCESS_MANAGE)
  async revoke(
    @Param('userId', UuidParamPipe) userId: string,
    @Param('permissionKey') permissionKey: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.adminPermissionsService.revoke(userId, permissionKey, actor.tenantScope);
    return { revoked: true };
  }
}

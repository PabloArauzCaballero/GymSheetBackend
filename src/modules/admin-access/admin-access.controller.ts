import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ADMIN_PERMISSION_KEYS } from './admin-permission.catalog';

/**
 * Franja 7d (ADR-0029): the granular permission catalog went with the staff
 * (its grants opened nothing since ADR-0019: every `admin/*` route is
 * `SYSTEM_ADMIN`'s). Only `me` stays, deprecated, so the current web keeps
 * gating the platform console with it until it decides by role.
 */
@Roles(UserRole.SYSTEM_ADMIN)
@Controller('admin/permissions')
export class AdminAccessController {
  @Get('me')
  getMine() {
    return { permissionKeys: [...ADMIN_PERMISSION_KEYS] };
  }
}

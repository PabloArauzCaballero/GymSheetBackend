import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminUserSearchInput, adminUserSearchSchema } from './admin-users.schemas';
import { AdminUsersService } from './admin-users.service';

/** REPP's account search; replaces the retired `admin/membership/users` (ADR-0026). */
@Roles(UserRole.SYSTEM_ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  search(@Query(new ZodValidationPipe(adminUserSearchSchema)) query: AdminUserSearchInput, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.search(query, actor.tenantScope);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminPermissionKey } from './admin-permission.catalog';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryInput, auditLogQuerySchema } from './audit.schemas';

/**
 * Log of administrative actions. Only REPP operates the platform (ADR-0019):
 * the scope comes from `actor.tenantScope`, null (every gym) for a
 * `SYSTEM_ADMIN` that is not impersonating, one gym while it impersonates.
 */
@Roles(UserRole.SYSTEM_ADMIN)
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @RequirePermission(AdminPermissionKey.ADMIN_ACCESS_MANAGE)
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQueryInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.auditLog.list(query, actor.tenantScope);
  }
}

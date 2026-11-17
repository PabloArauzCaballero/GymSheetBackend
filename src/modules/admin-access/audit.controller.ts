import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
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
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQueryInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.auditLog.list(query, actor.tenantScope);
  }
}

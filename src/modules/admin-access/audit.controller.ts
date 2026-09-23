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
 * Historial de acciones administrativas.
 *
 * Un solo endpoint para las dos consolas: el alcance sale de
 * `actor.tenantScope`, igual que en el resto de los módulos administrativos. Un
 * `SYSTEM_ADMIN` sin suplantar lo tiene nulo y ve la plataforma entera; un
 * `ADMIN` ve su gimnasio. Duplicarlo en `/admin/system/audit` sólo añadiría una
 * segunda ruta que mantener con la misma consulta detrás.
 */
@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
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

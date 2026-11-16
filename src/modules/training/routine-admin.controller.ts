import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { PLATFORM_MODERATION_ROLES, platformScopeOf } from '../../common/tenancy/tenant-scope';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminPermissionKey } from '../admin-access/admin-permission.catalog';
import { RoutineAdminService } from './routine-admin.service';
import { AdminRoutineListQuery, adminRoutineListQuerySchema } from './routine-v2.schemas';
import { CreateRoutineInput, createRoutineSchema } from './training.schemas';

/** REPP's routine back office (ADR-0019): writes are `SYSTEM_ADMIN` only; the listing is also open to moderators. */
@Roles(UserRole.SYSTEM_ADMIN)
@Controller('admin/routines')
export class RoutineAdminController {
  constructor(private readonly admin: RoutineAdminService) {}

  /**
   * The REPP console of routines: official ones, hidden ones and their open
   * reports. It is platform curation and moderation, not a gym operation
   * (ADR-0018), so only the platform moderation roles enter.
   */
  @Get()
  @Roles(...PLATFORM_MODERATION_ROLES)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(adminRoutineListQuerySchema)) query: AdminRoutineListQuery,
  ) {
    return this.admin.list(query, platformScopeOf(actor));
  }

  @Post()
  @Audited({ domain: 'routines', action: 'create-official', targetKind: 'routine', targetParam: 'id' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRoutineSchema)) input: CreateRoutineInput,
  ) {
    return this.admin.createOfficial(actor, input);
  }

  @Get(':id/insights')
  @RequirePermission(AdminPermissionKey.ANALYTICS_READ)
  insights(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.admin.insights(id, actor.tenantScope);
  }

  @Post(':id/official')
  @Audited({ domain: 'routines', action: 'mark-official', targetKind: 'routine', targetParam: 'id' })
  mark(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.admin.setOfficial(actor, id, true);
  }

  @Delete(':id/official')
  @Audited({ domain: 'routines', action: 'unmark-official', targetKind: 'routine', targetParam: 'id' })
  unmark(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.admin.setOfficial(actor, id, false);
  }
}

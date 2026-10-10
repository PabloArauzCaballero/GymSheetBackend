import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminPermissionKey } from '../admin-access/admin-permission.catalog';
import { ModerationService } from './moderation.service';
import { ModerationTargetKindValue } from './moderation.policy';
import { ModerationTargetKindPipe } from './target-kind.pipe';
import {
  CreateReportInput,
  ModerationQueueQuery,
  ResolveCaseInput,
  createReportSchema,
  moderationQueueQuerySchema,
  resolveCaseSchema,
} from './moderation.schemas';

/**
 * Denunciar, desde la aplicación.
 *
 * Con límite propio y más estrecho que el general: reportar crea trabajo para
 * una persona real, así que es una de las pocas escrituras que un usuario puede
 * disparar en cadena para hacer daño. Veinte por hora es mucho más de lo que
 * nadie denuncia de buena fe.
 */
@Throttle({
  default: { limit: 20, ttl: 60 * 60 * 1000 },
})
@Controller('me/reports')
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post()
  create(
    @CurrentUser() reporter: AuthenticatedUser,
    @Body(new ZodValidationPipe(createReportSchema)) input: CreateReportInput,
  ) {
    return this.moderation.report(reporter, input);
  }
}

/**
 * La consola de moderación.
 *
 * `@Roles(ADMIN, FRONT_DESK)` es el piso y el permiso granular lo estrecha:
 * recepción puede moderar sólo si alguien se lo concedió explícitamente en
 * `/admin/permissions`. Es la decisión de producto tomada para este módulo —
 * quien atiende el mostrador suele ser quien primero se entera de un problema,
 * pero no todos los mostradores deben poder suspender cuentas.
 */
@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller('admin/moderation')
export class ModerationAdminController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('queue')
  @RequirePermission(AdminPermissionKey.MODERATION_READ)
  queue(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(moderationQueueQuerySchema))
    query: ModerationQueueQuery,
  ) {
    return this.moderation.listQueue(actor, query.page, query.pageSize);
  }

  @Get('cases/:targetKind/:targetId')
  @RequirePermission(AdminPermissionKey.MODERATION_READ)
  getCase(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetKind', ModerationTargetKindPipe) targetKind: ModerationTargetKindValue,
    @Param('targetId', UuidParamPipe) targetId: string,
  ) {
    return this.moderation.getCase(actor, targetKind, targetId);
  }

  @Post('cases/:targetKind/:targetId/claim')
  @RequirePermission(AdminPermissionKey.MODERATION_ACT)
  @Audited({
    domain: 'moderation',
    action: 'claim',
    targetKind: 'case',
    targetParam: 'targetId',
  })
  claim(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetKind', ModerationTargetKindPipe) targetKind: ModerationTargetKindValue,
    @Param('targetId', UuidParamPipe) targetId: string,
  ) {
    return this.moderation.claim(actor, targetKind, targetId);
  }

  @Post('cases/:targetKind/:targetId/release')
  @RequirePermission(AdminPermissionKey.MODERATION_ACT)
  @Audited({
    domain: 'moderation',
    action: 'release',
    targetKind: 'case',
    targetParam: 'targetId',
  })
  release(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetKind', ModerationTargetKindPipe) targetKind: ModerationTargetKindValue,
    @Param('targetId', UuidParamPipe) targetId: string,
  ) {
    return this.moderation.release(actor, targetKind, targetId);
  }

  @Post('cases/:targetKind/:targetId/resolve')
  @RequirePermission(AdminPermissionKey.MODERATION_ACT)
  @Audited({
    domain: 'moderation',
    action: 'resolve',
    targetKind: 'case',
    targetParam: 'targetId',
  })
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetKind', ModerationTargetKindPipe) targetKind: ModerationTargetKindValue,
    @Param('targetId', UuidParamPipe) targetId: string,
    @Body(new ZodValidationPipe(resolveCaseSchema)) input: ResolveCaseInput,
  ) {
    return this.moderation.resolve(actor, targetKind, targetId, input);
  }

  @Get('users/:userId/history')
  @RequirePermission(AdminPermissionKey.MODERATION_READ)
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', UuidParamPipe) userId: string,
  ) {
    return this.moderation.historyFor(actor, userId);
  }
}

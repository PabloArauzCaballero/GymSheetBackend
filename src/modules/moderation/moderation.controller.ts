import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_MODERATION_ROLES } from '../../common/tenancy/tenant-scope';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AuditLogService } from '../admin-access/audit-log.service';
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
 * The moderation console of the central REPP team (ADR-0018).
 *
 * Only platform roles enter: `MODERATOR` (every gym) and `SYSTEM_ADMIN` (every
 * gym, or the impersonated one). Gym staff (`ADMIN`, `FRONT_DESK`, `COACH`)
 * gets 403 whatever permissions it was granted: moderating the social content
 * is not a gym operation, and no grant can turn it into one.
 */
@Roles(...PLATFORM_MODERATION_ROLES)
@Controller('admin/moderation')
export class ModerationAdminController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('queue')
  queue(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(moderationQueueQuerySchema))
    query: ModerationQueueQuery,
  ) {
    return this.moderation.listQueue(actor, query.page, query.pageSize);
  }

  @Get('cases/:targetKind/:targetId')
  getCase(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetKind', ModerationTargetKindPipe) targetKind: ModerationTargetKindValue,
    @Param('targetId', UuidParamPipe) targetId: string,
  ) {
    return this.moderation.getCase(actor, targetKind, targetId);
  }

  @Post('cases/:targetKind/:targetId/claim')
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

  /**
   * The verdict. Audited here and not with `@Audited()`: the row has to say
   * which kind of content, which gym and what was decided, and only the
   * verdict knows that. It is written after the decision committed, like the
   * interceptor does, and a failed decision writes nothing.
   */
  @Post('cases/:targetKind/:targetId/resolve')
  async resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetKind', ModerationTargetKindPipe) targetKind: ModerationTargetKindValue,
    @Param('targetId', UuidParamPipe) targetId: string,
    @Body(new ZodValidationPipe(resolveCaseSchema)) input: ResolveCaseInput,
    @Req() request: Request,
  ) {
    const verdict = await this.moderation.resolve(actor, targetKind, targetId, input);
    await this.auditLog.record(actor, {
      domain: 'moderation',
      action: 'resolve',
      targetKind: 'case',
      targetId,
      metadata: {
        caseKind: targetKind,
        tenantId: verdict.tenantId,
        resolution: verdict.resolution,
        sanction: verdict.sanction?.kind ?? null,
        contentHidden: verdict.contentHidden,
        minorConfirmed: verdict.minorConfirmed,
        businessSuspended: verdict.businessSuspended,
        reportsClosed: verdict.reportsClosed,
      },
      ip: request.ip ?? null,
      userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
    });
    return verdict;
  }

  @Get('users/:userId/history')
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', UuidParamPipe) userId: string,
  ) {
    return this.moderation.historyFor(actor, userId);
  }
}

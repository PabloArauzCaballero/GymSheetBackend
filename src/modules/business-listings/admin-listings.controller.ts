import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PLATFORM_MODERATION_ROLES } from '../../common/tenancy/tenant-scope';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AuditLogService } from '../admin-access/audit-log.service';
import { requestTrace } from '../business-kyc/admin-business-kyc.controller';
import { AdminListingsService } from './admin-listings.service';
import {
  AdminListingDecisionInput,
  AdminListingReleaseInput,
  AdminListingsQuery,
  adminListingDecisionSchema,
  adminListingReleaseSchema,
  adminListingsQuerySchema,
} from './business-listings.schemas';

/** REPP's listings console (ADR-0022): held, hidden and rejected listings. Every decision is audited. */
@Roles(...PLATFORM_MODERATION_ROLES)
@Controller('admin/business/listings')
export class AdminListingsController {
  constructor(
    private readonly listings: AdminListingsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query(new ZodValidationPipe(adminListingsQuerySchema)) query: AdminListingsQuery) {
    return this.listings.list(query);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  async release(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(adminListingReleaseSchema)) input: AdminListingReleaseInput,
    @Req() request: Request,
  ) {
    const result = await this.listings.release(actor, id, input);
    await this.auditLog.record(actor, { domain: 'business', action: 'listing-release', targetKind: 'business_listing', targetId: id, ...requestTrace(request) });
    return result;
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(adminListingDecisionSchema)) input: AdminListingDecisionInput,
    @Req() request: Request,
  ) {
    const result = await this.listings.reject(actor, id, input);
    await this.auditLog.record(actor, {
      domain: 'business',
      action: 'listing-reject',
      targetKind: 'business_listing',
      targetId: id,
      metadata: { reasonCode: input.reasonCode },
      ...requestTrace(request),
    });
    return result;
  }
}

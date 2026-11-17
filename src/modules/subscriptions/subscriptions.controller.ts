import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessSubscriptionsService } from './business-subscriptions.service';
import { MeSubscriptionsService } from './me-subscriptions.service';
import { PeriodDecisionInput, SubscribersQuery, cancelPeriodSchema, subscribersQuerySchema, suspendPeriodSchema } from './subscriptions.schemas';

/**
 * «Mis suscripciones» (ADR-0026). Persons only: a business account gets 403
 * from `AccountKindGuard`; someone else's period is 404.
 */
@Controller('me/subscriptions')
export class MeSubscriptionsController {
  constructor(private readonly subscriptions: MeSubscriptionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.subscriptions.list(actor);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.subscriptions.get(actor, id);
  }
}

/**
 * «Suscriptores» of the business (ADR-0026). Only `NEGOCIO`: a person, a
 * moderator or the platform admin gets 403 (REPP never touches a business's
 * subscribers); another business's period is 404.
 */
@Roles(UserRole.BUSINESS)
@Controller('business/me/subscriptions')
export class BusinessSubscriptionsController {
  constructor(private readonly subscriptions: BusinessSubscriptionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(subscribersQuerySchema)) query: SubscribersQuery) {
    return this.subscriptions.list(actor, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.subscriptions.get(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(cancelPeriodSchema)) input: PeriodDecisionInput,
  ) {
    return this.subscriptions.decide(actor, id, 'CANCEL', input);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(suspendPeriodSchema)) input: PeriodDecisionInput,
  ) {
    return this.subscriptions.decide(actor, id, 'SUSPEND', input);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.subscriptions.decide(actor, id, 'REACTIVATE', null);
  }
}

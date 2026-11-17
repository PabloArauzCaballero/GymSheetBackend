import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AffiliationRequestsService } from './affiliation-requests.service';
import {
  CoachRequestInput,
  EndAffiliationInput,
  GymConfirmedQuery,
  GymRequestsQuery,
  OwnListQuery,
  RejectAffiliationInput,
  coachRequestSchema,
  endAffiliationSchema,
  gymConfirmedQuerySchema,
  gymRequestsQuerySchema,
  ownListQuerySchema,
  rejectAffiliationSchema,
} from './affiliations.schemas';
import { GymAffiliationsService } from './gym-affiliations.service';

/**
 * The gym's «Socios» (ADR-0025). `NEGOCIO` with a GYM entity only: another
 * business type is 403, another gym's affiliation 404.
 */
@Roles(UserRole.BUSINESS)
@Controller('business/me/affiliations')
export class GymAffiliationsController {
  constructor(private readonly gym: GymAffiliationsService) {}

  @Get('requests')
  @Header('Cache-Control', 'private, no-store')
  requests(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(gymRequestsQuerySchema)) query: GymRequestsQuery) {
    return this.gym.listRequests(actor, query);
  }

  @Get('members')
  @Header('Cache-Control', 'private, no-store')
  members(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(gymConfirmedQuerySchema)) query: GymConfirmedQuery) {
    return this.gym.listConfirmed(actor, 'SOCIO', query);
  }

  @Get('coaches')
  @Header('Cache-Control', 'private, no-store')
  coaches(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(gymConfirmedQuerySchema)) query: GymConfirmedQuery) {
    return this.gym.listConfirmed(actor, 'ENTRENADOR', query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.gym.get(actor, id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.gym.confirm(actor, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string, @Body(new ZodValidationPipe(rejectAffiliationSchema)) input: RejectAffiliationInput) {
    return this.gym.reject(actor, id, input);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string, @Body(new ZodValidationPipe(endAffiliationSchema)) input: EndAffiliationInput) {
    return this.gym.end(actor, id, input);
  }
}

/**
 * «Mis gimnasios» of a coach business (ADR-0025): it asks a gym by @handle to
 * list it as a coach; the gym accepts. `NEGOCIO` with a COACH entity only.
 */
@Roles(UserRole.BUSINESS)
@Controller('business/me/gym-links')
export class CoachGymLinksController {
  constructor(private readonly affiliations: AffiliationRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiresVerifiedEmail()
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  async request(@CurrentUser() actor: AuthenticatedUser, @Body(new ZodValidationPipe(coachRequestSchema)) input: CoachRequestInput) {
    return this.affiliations.request(await this.affiliations.coachOf(actor), { ...input, kind: 'ENTRENADOR', ciLast3: null, switchGym: false });
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(ownListQuerySchema)) query: OwnListQuery) {
    return this.affiliations.list(await this.affiliations.coachOf(actor), query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async get(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.affiliations.get(await this.affiliations.coachOf(actor), id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.affiliations.cancel(await this.affiliations.coachOf(actor), id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  async end(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.affiliations.end(await this.affiliations.coachOf(actor), id);
  }
}

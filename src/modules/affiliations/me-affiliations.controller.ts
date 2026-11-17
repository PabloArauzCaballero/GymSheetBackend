import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AffiliationRequestsService } from './affiliation-requests.service';
import { OwnListQuery, PersonRequestInput, ownListQuerySchema, personRequestSchema } from './affiliations.schemas';

/**
 * A person's affiliations to gyms (ADR-0025): SOCIO of one gym, ENTRENADOR of
 * several. Persons only: a business account gets 403 from `AccountKindGuard`;
 * someone else's affiliation is 404 on every route.
 */
@Controller('me/affiliations')
export class MeAffiliationsController {
  constructor(private readonly affiliations: AffiliationRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiresVerifiedEmail()
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  request(@CurrentUser() actor: AuthenticatedUser, @Body(new ZodValidationPipe(personRequestSchema)) input: PersonRequestInput) {
    return this.affiliations.request(this.affiliations.personOf(actor), input);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(ownListQuerySchema)) query: OwnListQuery) {
    return this.affiliations.list(this.affiliations.personOf(actor), query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.affiliations.get(this.affiliations.personOf(actor), id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.affiliations.cancel(this.affiliations.personOf(actor), id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.affiliations.end(this.affiliations.personOf(actor), id);
  }
}

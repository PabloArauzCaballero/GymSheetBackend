import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { env } from '../../config/env';
import { handleParamSchema } from '../business-accounts/business-accounts.schemas';
import { PublicListingsQuery, publicListingsQuerySchema } from './business-listings.schemas';
import { PublicListingsService } from './public-listings.service';

const throttle = { default: { limit: env.PUBLIC_RATE_LIMIT_MAX, ttl: env.RATE_LIMIT_TTL_SECONDS * 1000 } };

/** The public marketplace (ADR-0022): only LIVE listings of ACTIVE businesses exist here. */
@Public()
@Throttle(throttle)
@Controller('public/directory')
export class PublicListingsController {
  constructor(private readonly listings: PublicListingsService) {}

  @Get('listings')
  @Header('Cache-Control', 'public, max-age=60')
  search(@Query(new ZodValidationPipe(publicListingsQuerySchema)) query: PublicListingsQuery) {
    return this.listings.search(query);
  }

  @Get('listings/:id')
  @Header('Cache-Control', 'public, max-age=60')
  get(@Param('id', UuidParamPipe) id: string) {
    return this.listings.get(id);
  }

  /** `{ handle, entity, locations, listings }` for a public business, `{ redirectTo }` for a renamed handle, 404 otherwise. */
  @Get('profiles/:handle')
  @Header('Cache-Control', 'public, max-age=60')
  profile(@Param('handle', new ZodValidationPipe(handleParamSchema)) handle: string) {
    return this.listings.profile(handle);
  }
}

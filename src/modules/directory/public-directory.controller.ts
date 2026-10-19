import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { env } from '../../config/env';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { DirectoryService } from './directory.service';
import {
  ListReviewsQuery,
  PublicDirectoryFilterQuery,
  listReviewsQuerySchema,
  publicDirectoryFilterQuerySchema,
} from './directory.schemas';

const publicThrottleOptions = {
  default: {
    limit: env.PUBLIC_RATE_LIMIT_MAX,
    ttl: env.RATE_LIMIT_TTL_SECONDS * 1000,
  },
};

@Controller('public/directory')
export class PublicDirectoryController {
  constructor(private readonly service: DirectoryService) {}

  @Public()
  @Throttle(publicThrottleOptions)
  @Header('Cache-Control', 'public, max-age=300')
  @Get('categories')
  getCategories(@Query('scope') scope?: string) {
    return this.service.getCategoryTree(scope);
  }

  @Public()
  @Throttle(publicThrottleOptions)
  @Header('Cache-Control', 'public, max-age=60')
  @Get('entities')
  listEntities(
    @Query(new ZodValidationPipe(publicDirectoryFilterQuerySchema))
    query: PublicDirectoryFilterQuery
  ) {
    return this.service.listEntities(query);
  }

  @Public()
  @Throttle(publicThrottleOptions)
  @Header('Cache-Control', 'public, max-age=60')
  @Get('entities/:slug')
  getEntityBySlug(@Param('slug') slug: string) {
    return this.service.getEntityBySlug(slug);
  }

  @Public()
  @Throttle(publicThrottleOptions)
  @Header('Cache-Control', 'public, max-age=30')
  @Get('entities/:id/reviews')
  listReviews(
    @Param('id', UuidParamPipe) entityId: string,
    @Query(new ZodValidationPipe(listReviewsQuerySchema)) query: ListReviewsQuery,
    @Req() req: Request & { user?: AuthenticatedUser }
  ) {
    const user = req.user;
    return this.service.listReviews(entityId, query, user?.id);
  }
}

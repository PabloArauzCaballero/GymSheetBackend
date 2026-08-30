import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { env } from '../../config/env';
import { PublicFacilitiesService } from './public-facilities.service';
import { PublicBranchListQuery, publicBranchListQuerySchema } from './public-facilities.schemas';

const publicThrottleOptions = {
  default: {
    limit: env.PUBLIC_RATE_LIMIT_MAX,
    ttl: env.RATE_LIMIT_TTL_SECONDS * 1000,
  },
};

/**
 * Directorio público de gimnasios (punto 14): rutas nuevas, sin sesión, que
 * proyectan una vista segura de `facilities` — nunca accesos, mantenimiento
 * ni nada operativo. Cacheable porque es contenido de bajo cambio.
 */
@Controller('public/facilities')
export class PublicFacilitiesController {
  constructor(private readonly service: PublicFacilitiesService) {}

  @Public()
  @Throttle(publicThrottleOptions)
  @Header('Cache-Control', 'public, max-age=60')
  @Get('branches')
  list(@Query(new ZodValidationPipe(publicBranchListQuerySchema)) query: PublicBranchListQuery) {
    return this.service.listBranches(query);
  }

  @Public()
  @Throttle(publicThrottleOptions)
  @Header('Cache-Control', 'public, max-age=60')
  @Get('branches/:id')
  get(@Param('id', UuidParamPipe) id: string) {
    return this.service.getBranch(id);
  }
}

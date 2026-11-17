import { Controller, Get, Header, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { env } from '../../config/env';
import { handleParamSchema } from './business-accounts.schemas';
import { HandlesService } from './handles.service';

const ttl = env.RATE_LIMIT_TTL_SECONDS * 1000;

/** Public `@handle` resolution and availability (ADR-0020). */
@Public()
@Controller('public/handles')
export class PublicHandlesController {
  constructor(private readonly handles: HandlesService) {}

  /** `{ handle, entity }` for a public listing, `{ redirectTo }` for a renamed one, 404 otherwise. */
  @Throttle({ default: { limit: env.PUBLIC_RATE_LIMIT_MAX, ttl } })
  @Header('Cache-Control', 'public, max-age=60')
  @Get(':handle')
  resolve(@Param('handle', new ZodValidationPipe(handleParamSchema)) handle: string) {
    return this.handles.resolve(handle);
  }

  /** Throttled on its own: it answers for every handle, so it must not become an enumeration oracle at scale. */
  @Throttle({ default: { limit: env.HANDLE_AVAILABILITY_RATE_LIMIT_MAX, ttl } })
  @Header('Cache-Control', 'no-store')
  @Get(':handle/availability')
  availability(@Param('handle', new ZodValidationPipe(handleParamSchema)) handle: string) {
    return this.handles.availability(handle);
  }
}

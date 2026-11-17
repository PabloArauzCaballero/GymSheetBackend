import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { env } from '../../config/env';
import { signupRequestMeta } from '../auth/signup-context';
import { BusinessSignupInput, businessSignupSchema } from './business-accounts.schemas';
import { BusinessSignupService } from './business-signup.service';

const authThrottleOptions = {
  default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl: env.RATE_LIMIT_TTL_SECONDS * 1000 },
};

/** Public business signup (ADR-0020), behind `BUSINESS_SIGNUP_ENABLED`. */
@Controller('business')
export class BusinessSignupController {
  constructor(private readonly signupService: BusinessSignupService) {}

  @Public()
  @Throttle(authThrottleOptions)
  @HttpCode(HttpStatus.CREATED)
  @Post('signup')
  signup(@Body(new ZodValidationPipe(businessSignupSchema)) input: BusinessSignupInput, @Req() request: Request) {
    return this.signupService.signup(input, signupRequestMeta(request));
  }
}

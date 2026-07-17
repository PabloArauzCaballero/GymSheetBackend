import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { AuthService } from './auth.service';
import { LoginInput, RegisterInput, loginSchema, registerSchema } from './auth.schemas';

const authThrottleOptions = {
  default: {
    limit: env.AUTH_RATE_LIMIT_MAX,
    ttl: env.RATE_LIMIT_TTL_SECONDS * 1000,
  },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(authThrottleOptions)
  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) input: RegisterInput) {
    return this.authService.register(input);
  }

  @Public()
  @Throttle(authThrottleOptions)
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput) {
    return this.authService.login(input);
  }

  @Get('me')
  getMe(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    return authenticatedUser;
  }
}

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { AuthService } from './auth.service';
import {
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
} from './auth.schemas';

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

  /**
   * Public on purpose: the access token is usually already expired when this
   * is called. The refresh token in the body is the credential.
   *
   * Uses the general rate limit, not the strict login one: a 256-bit random
   * token cannot be brute-forced, and many members of one gym share the same
   * public IP (its Wi-Fi), so 10/min per IP would log people out at peak hours.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(refreshTokenSchema)) input: RefreshTokenInput) {
    return this.authService.refresh(input.refreshToken);
  }

  /** Revokes the session the refresh token belongs to. Works with an expired access token. */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body(new ZodValidationPipe(refreshTokenSchema)) input: RefreshTokenInput) {
    return this.authService.logout(input.refreshToken);
  }

  @Get('me')
  getMe(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    return authenticatedUser;
  }
}

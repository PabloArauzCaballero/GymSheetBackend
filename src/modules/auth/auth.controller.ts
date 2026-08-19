import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { AuthService } from './auth.service';
import {
  LoginInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  RegisterInput,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
} from './auth.schemas';
import { PasswordResetService } from './password-reset.service';

const authThrottleOptions = {
  default: {
    limit: env.AUTH_RATE_LIMIT_MAX,
    ttl: env.RATE_LIMIT_TTL_SECONDS * 1000,
  },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

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
   * Pide un PIN al correo. Responde 202 siempre, exista la cuenta o no.
   *
   * El código de estado forma parte de la decisión: 202 dice «queda aceptado y
   * se procesará», que es cierto en ambos casos y no revela nada. Un 200 con
   * cuerpo o un 404 convertirían este endpoint en un comprobador de qué
   * direcciones están registradas.
   *
   * El límite de peticiones es el de autenticación, no uno propio: mandar
   * correos a demanda de un desconocido es más caro que probar una contraseña,
   * no menos.
   */
  @Public()
  @Throttle(authThrottleOptions)
  @HttpCode(202)
  @Post('password-reset/request')
  async requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) input: PasswordResetRequestInput,
    @Ip() requesterIp: string,
  ) {
    await this.passwordReset.requestPin(input.email, requesterIp || null);
    return { accepted: true };
  }

  /** Canjea el PIN por una contraseña nueva. */
  @Public()
  @Throttle(authThrottleOptions)
  @HttpCode(200)
  @Post('password-reset/confirm')
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) input: PasswordResetConfirmInput,
  ) {
    await this.passwordReset.confirm(input.email, input.pin, input.password);
    return { updated: true };
  }

  @Get('me')
  getMe(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    return authenticatedUser;
  }
}

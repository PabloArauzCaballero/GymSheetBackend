import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SocketTicketService } from '../../common/realtime/socket-ticket.service';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { AuthService } from './auth.service';
import {
  ImpersonateTenantInput,
  impersonateTenantSchema,
  LoginInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  RefreshTokenInput,
  RegisterInput,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
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
  constructor(
    private readonly authService: AuthService,
    private readonly socketTickets: SocketTicketService,
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

  @Public()
  @Throttle(authThrottleOptions)
  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(refreshTokenSchema)) input: RefreshTokenInput) {
    return this.authService.refresh(input.refreshToken);
  }

  // Public because a refresh token, not the (possibly already expired) access
  // token, is what authorizes ending a session — the client may be logging
  // out precisely because the access token no longer works.
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body(new ZodValidationPipe(refreshTokenSchema)) input: RefreshTokenInput) {
    await this.authService.logout(input.refreshToken);
  }

  // 202: accepted regardless of whether the email matches an account — the
  // response must never let a caller distinguish the two cases.
  @Public()
  @Throttle(authThrottleOptions)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password-reset/request')
  requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) input: PasswordResetRequestInput,
  ) {
    return this.authService.requestPasswordReset(input);
  }

  @Public()
  @Throttle(authThrottleOptions)
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) input: PasswordResetConfirmInput,
  ) {
    return this.authService.confirmPasswordReset(input);
  }

  /**
   * Canjea un token acotado al gimnasio indicado, conservando el rol.
   * `RolesGuard` ya cierra la puerta a cualquier otro rol; el servicio lo
   * vuelve a comprobar porque un privilegio de este alcance no debe depender
   * de que un decorador siga en su sitio tras el próximo refactor.
   */
  @Roles(UserRole.SYSTEM_ADMIN)
  @Post('impersonate-tenant')
  impersonateTenant(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(impersonateTenantSchema)) input: ImpersonateTenantInput,
  ) {
    return this.authService.impersonateTenant(actor, input);
  }

  @Get('me')
  getMe(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    return authenticatedUser;
  }

  // Boleto de un solo uso (30s) para abrir el socket de chat: el navegador
  // nunca ve el JWT de acceso, solo este boleto efímero.
  @Post('socket-ticket')
  async issueSocketTicket(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    const ticket = await this.socketTickets.issue(authenticatedUser.id);
    return { ticket };
  }
}

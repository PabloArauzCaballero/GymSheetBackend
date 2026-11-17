import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_VERIFIED_EMAIL_KEY } from '../decorators/requires-verified-email.decorator';
import { DomainException } from '../errors/domain.exception';
import { AuthenticatedUser } from '../types/auth-context.types';

/**
 * Closes the routes marked `@RequiresVerifiedEmail()` to accounts with an
 * unverified email: `403 EMAIL_VERIFICATION_REQUIRED`. No extra query: the JWT
 * strategy already read the flag from the database for this request.
 * Unmarked routes are untouched, so the rest of the app stays usable.
 */
@Injectable()
export class EmailVerificationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_VERIFIED_EMAIL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (request.user?.emailVerified === true) return true;
    throw new DomainException(
      HttpStatus.FORBIDDEN,
      'EMAIL_VERIFICATION_REQUIRED',
      'Confirma tu correo para usar las funciones sociales.',
    );
  }
}

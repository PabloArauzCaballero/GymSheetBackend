import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { decode } from 'jsonwebtoken';
import { IS_PUBLIC_ROUTE_KEY } from '../decorators/public.decorator';

/** `type` del problem+json cuando lo que caduca es una suplantación, no la sesión. */
export const IMPERSONATION_EXPIRED_ERROR_TYPE =
  'https://gymsheet.api/errors/impersonation-expired';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublicRoute = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublicRoute) {
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * Distingue «caducó la suplantación» de «caducó la sesión».
   *
   * Los dos son 401 y un cliente no puede separarlos, así que su manejador de
   * 401 cierra la sesión entera: el administrador acaba expulsado del portal
   * cada pocos minutos por culpa de un token que, por diseño, es de vida
   * corta. Lo correcto es devolverlo a su propio gimnasio, no echarlo.
   *
   * El token caducado se descodifica SIN verificar, y eso es seguro aquí
   * porque de esta lectura no depende ningún privilegio: passport ya rechazó
   * la petición y lo único que se decide es qué etiqueta lleva el error.
   */
  handleRequest<TUser>(
    error: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const expired =
      info instanceof Error && info.name === 'TokenExpiredError';

    if (!user && expired && this.wasImpersonating(context)) {
      throw new UnauthorizedException({
        message: 'La suplantación de gimnasio ha caducado.',
        type: IMPERSONATION_EXPIRED_ERROR_TYPE,
      });
    }

    return super.handleRequest(error, user, info, context);
  }

  private wasImpersonating(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) return false;

    try {
      const payload = decode(header.slice('Bearer '.length));
      return (
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { tenantId?: unknown }).tenantId === 'string'
      );
    } catch {
      return false;
    }
  }
}

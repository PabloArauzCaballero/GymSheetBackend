import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import {
  AUDITED_KEY,
  AuditedMetadata,
} from '../../common/decorators/audited.decorator';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AuditLogService } from './audit-log.service';

/** Recorta lo que se guarda: un agente de usuario no tiene por qué caber en la tabla. */
const MAX_USER_AGENT_LENGTH = 500;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditedMetadata>(AUDITED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sin decorador no hay auditoría: igual que `RolesGuard` y `PermissionGuard`,
    // esto sólo actúa sobre las rutas que se apuntan explícitamente.
    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<
      Request & { user?: AuthenticatedUser }
    >();
    const actor = request.user;
    if (!actor) return next.handle();

    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const targetId = metadata.targetParam ? (params[metadata.targetParam] ?? null) : null;
    const userAgent = request.get('user-agent') ?? null;

    return next.handle().pipe(
      // `tap` con sólo el canal de éxito: si el handler lanzó, la petición no
      // llega aquí y no se registra nada. Un intento fallido no es una acción
      // administrativa, y anotarlo como si lo fuera volvería el historial
      // inútil justo cuando hace falta leerlo.
      tap(() => {
        void this.auditLog.record(actor, {
          domain: metadata.domain,
          action: metadata.action,
          targetKind: metadata.targetKind ?? null,
          targetId,
          ip: request.ip ?? null,
          userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
        });
      }),
    );
  }
}

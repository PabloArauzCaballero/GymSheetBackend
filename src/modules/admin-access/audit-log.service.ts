import { Injectable, Logger } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminAuditLogModel } from './audit-log.model';
import {
  AuditLogEntry,
  AuditLogQuery,
  AuditLogRepository,
} from './audit-log.repository';

/** Lo que el interceptor sabe de una acción, antes de resolver al actor. */
export type AuditableAction = {
  domain: string;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  metadata?: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
};

export type AuditLogPage = {
  items: ReturnType<typeof mapAuditEntry>[];
  /** Opaco; se devuelve tal cual al pedir la página siguiente. Nulo = no hay más. */
  nextCursor: string | null;
};

function mapAuditEntry(row: AdminAuditLogModel) {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    tenantScope: row.tenantScope,
    domain: row.domain,
    action: row.action,
    targetKind: row.targetKind,
    targetId: row.targetId,
    metadata: row.metadata,
  };
}

/**
 * El cursor viaja como un solo texto opaco para que el cliente no lo componga
 * a mano: es una posición de recorrido, no un filtro que tenga sentido editar.
 */
function encodeCursor(row: AdminAuditLogModel): string {
  return Buffer.from(`${row.occurredAt.toISOString()}|${row.id}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) return null;
  const occurredAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(occurredAt.getTime()) || !id) return null;
  return { occurredAt, id };
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly repository: AuditLogRepository) {}

  /**
   * Deja constancia de una acción ya ejecutada.
   *
   * No lanza nunca. La acción ya se aplicó y se respondió cuando esto corre, de
   * modo que propagar el fallo convertiría una operación exitosa en un error
   * para quien la pidió, sin deshacer nada. El fallo se registra en el log del
   * proceso con `event` propio para que sea alertable: perder auditoría en
   * silencio sería el peor de los dos resultados posibles.
   */
  async record(actor: AuthenticatedUser, action: AuditableAction): Promise<void> {
    const entry: AuditLogEntry = {
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      // Se guarda el alcance sobre el que se actuó, no el gimnasio del actor:
      // durante una suplantación son cosas distintas y la pregunta que importa
      // es sobre qué gimnasio cayó la acción.
      tenantScope: actor.tenantScope,
      domain: action.domain,
      action: action.action,
      targetKind: action.targetKind,
      targetId: action.targetId,
      metadata: {
        ...(action.metadata ?? {}),
        ...(actor.impersonating ? { impersonating: true } : {}),
      },
      ip: action.ip,
      userAgent: action.userAgent,
    };

    try {
      await this.repository.record(entry);
    } catch (error) {
      this.logger.error(
        {
          event: 'admin.audit_write_failed',
          domain: action.domain,
          action: action.action,
          actorUserId: actor.id,
          detail: error instanceof Error ? error.message : 'unknown',
        },
        AuditLogService.name,
      );
    }
  }

  /**
   * Historial visible para el actor.
   *
   * Un `SYSTEM_ADMIN` sin suplantar (`tenantScope` nulo) ve la plataforma
   * entera, incluidas las filas de cada gimnasio; cualquier otro principal ve
   * sólo las de su gimnasio. Es el mismo convenio que el resto de los módulos
   * administrativos, y por eso no hace falta un segundo endpoint de sistema.
   */
  async list(
    query: Omit<AuditLogQuery, 'cursor'> & { cursor?: string },
    tenantScope: string | null,
  ): Promise<AuditLogPage> {
    // El cursor entra como texto y sale como posición: se saca del resto de los
    // filtros para que no viaje al repositorio con su forma de transporte.
    const { cursor: encodedCursor, ...filters } = query;
    const cursor = encodedCursor ? decodeCursor(encodedCursor) : null;

    // Se pide una fila de más para saber si hay página siguiente sin contar la
    // tabla entera: un `COUNT` sobre un log que sólo crece es caro y además no
    // se usa para nada — la interfaz es «cargar más», no «página 7 de 400».
    const rows = await this.repository.findPage(
      { ...filters, limit: filters.limit + 1, ...(cursor ? { cursor } : {}) },
      tenantScope === null ? undefined : tenantScope,
    );

    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;
    const lastRow = page.at(-1);

    return {
      items: page.map(mapAuditEntry),
      nextCursor: hasMore && lastRow ? encodeCursor(lastRow) : null,
    };
  }
}

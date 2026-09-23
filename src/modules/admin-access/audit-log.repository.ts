import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';
import { AdminAuditLogModel } from './audit-log.model';

/** Fila lista para insertar; el modelo pone id y `occurredAt` si no vienen. */
export type AuditLogEntry = {
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  tenantScope: string | null;
  domain: string;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
};

export type AuditLogQuery = {
  actorUserId?: string;
  domain?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit: number;
  /** Posición de la página anterior; excluyente. */
  cursor?: { occurredAt: Date; id: string };
};

@Injectable()
export class AuditLogRepository {
  constructor(
    @InjectModel(AdminAuditLogModel)
    private readonly auditLog: typeof AdminAuditLogModel,
  ) {}

  record(entry: AuditLogEntry): Promise<AdminAuditLogModel> {
    return this.auditLog.create({ ...entry });
  }

  /**
   * Página de actividad, de la más reciente a la más antigua.
   *
   * Paginación keyset y no `OFFSET`: la tabla crece por su cola en cada
   * petición administrativa, así que con offset la página 2 se solapa con la 1
   * en cuanto alguien actúa mientras se navega, y las filas nuevas empujan a
   * las viejas fuera de sitio. El cursor es la posición exacta de la última
   * fila entregada, y el desempate por `id` completa el orden que el índice ya
   * materializa.
   *
   * `tenantScope` nulo NO significa «sin filtro» aquí: significa filtrar por
   * las filas de plataforma. Quien quiera ver todo pasa `undefined`, y esa
   * diferencia la resuelve el servicio, no este método.
   */
  findPage(
    query: AuditLogQuery,
    tenantScope: string | null | undefined,
  ): Promise<AdminAuditLogModel[]> {
    const where: WhereOptions = {};

    if (tenantScope !== undefined) {
      Object.assign(where, { tenantScope });
    }
    if (query.actorUserId) Object.assign(where, { actorUserId: query.actorUserId });
    if (query.domain) Object.assign(where, { domain: query.domain });
    if (query.action) Object.assign(where, { action: query.action });

    const occurredAtFilters: Record<symbol, Date> = {};
    if (query.from) occurredAtFilters[Op.gte] = query.from;
    if (query.to) occurredAtFilters[Op.lte] = query.to;
    if (Object.getOwnPropertySymbols(occurredAtFilters).length > 0) {
      Object.assign(where, { occurredAt: occurredAtFilters });
    }

    // `(occurred_at, id) < (cursor.occurredAt, cursor.id)` expresado con los
    // operadores de Sequelize: empatar en el instante y seguir por id es lo que
    // impide que una fila se repita o se pierda entre páginas.
    if (query.cursor) {
      Object.assign(where, {
        [Op.or]: [
          { occurredAt: { [Op.lt]: query.cursor.occurredAt } },
          {
            occurredAt: query.cursor.occurredAt,
            id: { [Op.lt]: query.cursor.id },
          },
        ],
      });
    }

    return this.auditLog.findAll({
      where,
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ModerationReportModel } from './report.model';
import { UserStrikeModel } from './user-strike.model';
import {
  ModerationReasonValue,
  ModerationStatus,
  ModerationTargetKindValue,
} from './moderation.policy';

/** Una tarjeta de la cola: un contenido con todas sus quejas juntas. */
export interface ModerationCaseRow {
  target_kind: ModerationTargetKindValue;
  target_id: string;
  reported_user_id: string;
  reported_user_name: string;
  tenant_id: string;
  report_count: number;
  reporter_count: number;
  reasons: ModerationReasonValue[];
  severity: number;
  first_reported_at: Date;
  last_reported_at: Date;
  claimed_by_user_id: string | null;
  claimed_by_name: string | null;
  claimed_at: Date | null;
  content_hidden: boolean;
}

@Injectable()
export class ModerationRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ModerationReportModel)
    private readonly reports: typeof ModerationReportModel,
    @InjectModel(UserStrikeModel)
    private readonly strikes: typeof UserStrikeModel,
  ) {}

  createReport(
    input: {
      tenantId: string;
      reporterUserId: string;
      reportedUserId: string;
      targetKind: ModerationTargetKindValue;
      targetId: string;
      reason: ModerationReasonValue;
      details: string | null;
    },
    transaction?: Transaction,
  ): Promise<ModerationReportModel> {
    return this.reports.create(
      { ...input, status: ModerationStatus.PENDIENTE },
      { transaction },
    );
  }

  /**
   * Denunciantes DISTINTOS con una queja abierta sobre este contenido.
   *
   * Distintos y no filas: es el número que decide el auto-ocultado, y contarlo
   * por filas dejaría que una sola persona reportando varias veces tumbara
   * contenido ajeno. La unicidad parcial de la tabla ya lo impide, pero el
   * recuento no debe depender de que ese índice siga existiendo.
   */
  async countDistinctReporters(
    targetKind: ModerationTargetKindValue,
    targetId: string,
    transaction?: Transaction,
  ): Promise<number> {
    const rows = await this.sequelize.query<{ total: string }>(
      `SELECT count(DISTINCT reporter_user_id) AS total
         FROM moderation.reports
        WHERE target_kind = :targetKind
          AND target_id = :targetId
          AND status IN ('PENDIENTE', 'EN_REVISION')`,
      {
        type: QueryTypes.SELECT,
        replacements: { targetKind, targetId },
        transaction,
      },
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * La cola de trabajo.
   *
   * Agrupa por contenido —cinco quejas sobre la misma foto son UNA tarjeta— y
   * ordena por urgencia antes que por antigüedad: una denuncia por un menor no
   * puede esperar detrás de cuarenta de spam. Dentro de la misma urgencia manda
   * la antigüedad, para que nada se quede al fondo para siempre.
   *
   * La severidad se calcula en SQL y no en el proceso porque es criterio de
   * ORDENACIÓN: resolverla en JavaScript obligaría a traerse la cola entera
   * para poder decidir qué va primero.
   */
  findQueue(
    input: { tenantScope: string | null; limit: number; offset: number },
  ): Promise<ModerationCaseRow[]> {
    return this.sequelize.query<ModerationCaseRow>(
      `SELECT r.target_kind,
              r.target_id,
              r.reported_user_id,
              u.nombre_completo                                   AS reported_user_name,
              min(r.tenant_id)                                    AS tenant_id,
              count(*)::int                                       AS report_count,
              count(DISTINCT r.reporter_user_id)::int             AS reporter_count,
              array_agg(DISTINCT r.reason)                        AS reasons,
              max(CASE r.reason
                    WHEN 'MENOR_DE_EDAD' THEN 3
                    WHEN 'VIOLENCIA' THEN 3
                    WHEN 'ACOSO' THEN 2
                    WHEN 'DISCURSO_DE_ODIO' THEN 2
                    WHEN 'CONTENIDO_SEXUAL' THEN 2
                    ELSE 1
                  END)::int                                       AS severity,
              min(r.created_at)                                   AS first_reported_at,
              max(r.created_at)                                   AS last_reported_at,
              -- max() no existe para uuid, y castear a texto para agregar y
              -- volver a uuid sería pedirle a Postgres que ordene identificadores
              -- como cadenas. Todas las filas abiertas de un caso comparten
              -- reclamante, así que basta con tomar el primero no nulo.
              (array_agg(r.claimed_by_user_id) FILTER (
                 WHERE r.claimed_by_user_id IS NOT NULL))[1]      AS claimed_by_user_id,
              (array_agg(claimer.nombre_completo) FILTER (
                 WHERE claimer.nombre_completo IS NOT NULL))[1]   AS claimed_by_name,
              max(r.claimed_at)                                   AS claimed_at,
              -- Si el contenido ya está oculto (por umbral o por un moderador),
              -- la tarjeta lo dice: cambia lo urgente que es mirarla.
              --
              -- Se combinan con OR y no con COALESCE: bool_or sobre un LEFT
              -- JOIN que no casó devuelve false, no NULL, así que un COALESCE
              -- se quedaría siempre con la primera rama y las fotos ocultas se
              -- reportarían como visibles.
              (bool_or(st.hidden_at IS NOT NULL)
               OR bool_or(ph.hidden_at IS NOT NULL))              AS content_hidden
         FROM moderation.reports r
         JOIN public.usuarios u ON u.id = r.reported_user_id
         LEFT JOIN public.usuarios claimer ON claimer.id = r.claimed_by_user_id
         LEFT JOIN profile.stories st
           ON r.target_kind = 'STORY' AND st.id = r.target_id
         LEFT JOIN profile.photos ph
           ON r.target_kind = 'PROFILE_PHOTO' AND ph.id = r.target_id
        WHERE r.status IN ('PENDIENTE', 'EN_REVISION')
          AND (:tenantScope IS NULL OR r.tenant_id = :tenantScope)
        GROUP BY r.target_kind, r.target_id, r.reported_user_id, u.nombre_completo
        ORDER BY severity DESC, first_reported_at ASC
        LIMIT :limit OFFSET :offset`,
      {
        type: QueryTypes.SELECT,
        replacements: input,
      },
    );
  }

  /** Las quejas concretas de un caso, con el nombre de quien las puso. */
  findReportsForTarget(
    targetKind: ModerationTargetKindValue,
    targetId: string,
    tenantScope: string | null,
  ): Promise<ModerationReportModel[]> {
    return this.reports.findAll({
      where: {
        targetKind,
        targetId,
        ...(tenantScope ? { tenantId: tenantScope } : {}),
      },
      order: [['createdAt', 'ASC']],
    });
  }

  findOpenReportsForTarget(
    targetKind: ModerationTargetKindValue,
    targetId: string,
    tenantScope: string | null,
    transaction?: Transaction,
  ): Promise<ModerationReportModel[]> {
    return this.reports.findAll({
      where: {
        targetKind,
        targetId,
        status: [ModerationStatus.PENDIENTE, ModerationStatus.EN_REVISION],
        ...(tenantScope ? { tenantId: tenantScope } : {}),
      },
      transaction,
    });
  }

  /**
   * Toma el caso.
   *
   * Sólo agarra lo que nadie tiene en la mano (`claimed_by_user_id IS NULL`), y
   * devuelve cuántas filas cambió: cero significa que otro moderador llegó
   * primero, y quien llama debe decirlo en vez de dejar que dos personas
   * decidan por separado sobre la misma foto.
   */
  async claim(
    targetKind: ModerationTargetKindValue,
    targetId: string,
    moderatorUserId: string,
    tenantScope: string | null,
  ): Promise<number> {
    const [affected] = await this.reports.update(
      {
        status: ModerationStatus.EN_REVISION,
        claimedByUserId: moderatorUserId,
        claimedAt: new Date(),
      },
      {
        where: {
          targetKind,
          targetId,
          status: ModerationStatus.PENDIENTE,
          claimedByUserId: { [Op.is]: null },
          ...(tenantScope ? { tenantId: tenantScope } : {}),
        },
      },
    );
    return affected;
  }

  /** Suelta el caso sin resolverlo: vuelve a la cola tal y como estaba. */
  async release(
    targetKind: ModerationTargetKindValue,
    targetId: string,
    moderatorUserId: string,
    tenantScope: string | null,
  ): Promise<number> {
    const [affected] = await this.reports.update(
      { status: ModerationStatus.PENDIENTE, claimedByUserId: null, claimedAt: null },
      {
        where: {
          targetKind,
          targetId,
          status: ModerationStatus.EN_REVISION,
          claimedByUserId: moderatorUserId,
          ...(tenantScope ? { tenantId: tenantScope } : {}),
        },
      },
    );
    return affected;
  }

  /** Cierra todas las quejas abiertas de un contenido con el mismo veredicto. */
  async resolveTarget(
    input: {
      targetKind: ModerationTargetKindValue;
      targetId: string;
      resolution: string;
      note: string | null;
      moderatorUserId: string;
      discarded: boolean;
      tenantScope: string | null;
    },
    transaction: Transaction,
  ): Promise<number> {
    const [affected] = await this.reports.update(
      {
        status: input.discarded ? ModerationStatus.DESCARTADO : ModerationStatus.RESUELTO,
        resolution: input.resolution,
        resolutionNote: input.note,
        resolvedByUserId: input.moderatorUserId,
        resolvedAt: new Date(),
      },
      {
        where: {
          targetKind: input.targetKind,
          targetId: input.targetId,
          status: [ModerationStatus.PENDIENTE, ModerationStatus.EN_REVISION],
          ...(input.tenantScope ? { tenantId: input.tenantScope } : {}),
        },
        transaction,
      },
    );
    return affected;
  }

  /**
   * Sanciones que todavía pesan.
   *
   * El filtro por `expiresAt` es la caducidad de la escalera: lo que ya expiró
   * sigue en la tabla como historial, pero no cuenta para el siguiente castigo.
   */
  countActiveStrikes(
    userId: string,
    now: Date,
    transaction?: Transaction,
  ): Promise<number> {
    return this.strikes.count({
      where: { userId, expiresAt: { [Op.gt]: now } },
      transaction,
    });
  }

  listStrikes(userId: string): Promise<UserStrikeModel[]> {
    return this.strikes.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
  }

  createStrike(
    input: {
      userId: string;
      tenantId: string;
      kind: string;
      reason: ModerationReasonValue;
      note: string | null;
      targetKind: ModerationTargetKindValue | null;
      targetId: string | null;
      issuedByUserId: string;
      suspendedUntil: Date | null;
      expiresAt: Date;
    },
    transaction: Transaction,
  ): Promise<UserStrikeModel> {
    return this.strikes.create({ ...input }, { transaction });
  }

  /**
   * Oculta o revela contenido.
   *
   * Es SQL directo y no un modelo porque las dos tablas destino viven en otros
   * módulos (`profile.stories`, `profile.photos`) y moderación no debe
   * adueñarse de sus modelos para tocarles una columna. El nombre de tabla no
   * viene del exterior: sale de un `switch` sobre un tipo cerrado.
   */
  async setContentHidden(
    input: {
      targetKind: ModerationTargetKindValue;
      targetId: string;
      hidden: boolean;
      /** Nulo cuando lo oculta el umbral automático y no una persona. */
      moderatorUserId: string | null;
      reason: ModerationReasonValue | null;
    },
    transaction: Transaction,
  ): Promise<void> {
    const table =
      input.targetKind === 'STORY' ? 'profile.stories' : 'profile.photos';

    await this.sequelize.query(
      `UPDATE ${table}
          SET hidden_at = ${input.hidden ? 'now()' : 'NULL'},
              hidden_by_user_id = ${input.hidden ? ':moderatorUserId' : 'NULL'},
              hidden_reason = ${input.hidden ? ':reason' : 'NULL'}
        WHERE id = :targetId`,
      {
        type: QueryTypes.UPDATE,
        replacements: {
          targetId: input.targetId,
          ...(input.hidden
            ? { moderatorUserId: input.moderatorUserId, reason: input.reason }
            : {}),
        },
        transaction,
      },
    );
  }

  /** Dueño de un contenido, para resolver a quién se sanciona. Nulo si no existe. */
  async findContentOwner(
    targetKind: ModerationTargetKindValue,
    targetId: string,
  ): Promise<{ userId: string; tenantId: string } | null> {
    const queries: Record<string, string | null> = {
      STORY: `SELECT s.user_id AS "userId", u.tenant_id AS "tenantId"
                FROM profile.stories s JOIN public.usuarios u ON u.id = s.user_id
               WHERE s.id = :targetId`,
      PROFILE_PHOTO: `SELECT p.user_id AS "userId", u.tenant_id AS "tenantId"
                        FROM profile.photos p JOIN public.usuarios u ON u.id = p.user_id
                       WHERE p.id = :targetId`,
      CHAT_MESSAGE: `SELECT m.sender_id AS "userId", u.tenant_id AS "tenantId"
                       FROM chat.messages m JOIN public.usuarios u ON u.id = m.sender_id
                      WHERE m.id = :targetId`,
      USER: `SELECT u.id AS "userId", u.tenant_id AS "tenantId"
               FROM public.usuarios u WHERE u.id = :targetId`,
    };

    const sql = queries[targetKind];
    if (!sql) return null;

    const rows = await this.sequelize.query<{ userId: string; tenantId: string }>(sql, {
      type: QueryTypes.SELECT,
      replacements: { targetId },
    });
    return rows[0] ?? null;
  }

  /** Aplica (o levanta) la suspensión temporal de una cuenta. */
  async setSuspension(
    userId: string,
    suspendedUntil: Date | null,
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `UPDATE public.usuarios SET suspended_until = :suspendedUntil WHERE id = :userId`,
      {
        type: QueryTypes.UPDATE,
        replacements: { userId, suspendedUntil },
        transaction,
      },
    );
  }
}

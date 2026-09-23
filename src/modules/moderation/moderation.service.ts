import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ConnectionStatus, NotificationChannel } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ConnectionModel } from '../social/connection.model';
import { DiscoveryPassModel } from '../social/discovery-pass.model';
import { NotificationService } from '../notifications/notification.service';
import { ModerationRepository } from './moderation.repository';
import {
  AUTO_HIDE_DISTINCT_REPORTERS,
  isHideableTarget,
  ModerationReasonValue,
  ModerationResolution,
  ModerationResolutionValue,
  ModerationTargetKind,
  ModerationTargetKindValue,
  nextSanction,
  Sanction,
  strikeExpiryFrom,
  StrikeKind,
} from './moderation.policy';
import { CreateReportInput, ResolveCaseInput } from './moderation.schemas';

/** Lo que se le enseña al moderador antes de que decida. */
export interface CasePreview {
  targetKind: ModerationTargetKindValue;
  targetId: string;
  reportedUser: { id: string; name: string; suspendedUntil: string | null };
  reports: {
    id: string;
    reporterUserId: string;
    reason: ModerationReasonValue;
    details: string | null;
    createdAt: string;
    status: string;
  }[];
  activeStrikes: number;
  /** Qué sanción tocaría, calculada antes de aplicarla. */
  pendingSanction: { kind: string; days: number | null };
  contentHidden: boolean;
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: ModerationRepository,
    private readonly notifications: NotificationService,
    @InjectModel(ConnectionModel)
    private readonly connections: typeof ConnectionModel,
    @InjectModel(DiscoveryPassModel)
    private readonly passes: typeof DiscoveryPassModel,
  ) {}

  /**
   * Alguien denuncia algo.
   *
   * Hace tres cosas, y las tres importan:
   *
   * 1. **Registra la queja.** Si ya tenía una abierta sobre lo mismo, no crea
   *    otra — el índice parcial lo garantiza y aquí se traduce a un 409 legible
   *    en vez de a un error de base de datos.
   * 2. **Aparta a esa persona de su vista** (patrón de Tinder). Denunciar no es
   *    sólo quejarse: es «no quiero volver a ver a este señor». Esperar a que un
   *    moderador resuelva para que deje de aparecer en la baraja es exactamente
   *    la espera que hace que la gente abandone la aplicación en vez de
   *    denunciar.
   * 3. **Oculta el contenido si ya se quejaron bastantes personas distintas**
   *    (patrón de Tinder/Facebook). Es reversible y no sanciona a nadie: baja la
   *    cortina mientras llega un humano.
   */
  async report(reporter: AuthenticatedUser, input: CreateReportInput) {
    const owner = await this.repository.findContentOwner(
      input.targetKind,
      input.targetId,
    );

    // 404 y no 403: quien reporta no tiene por qué saber si el contenido existe
    // pero es de otro gimnasio, y distinguir ambos casos confirmaría
    // identificadores ajenos uno a uno.
    if (!owner || owner.tenantId !== reporter.tenantId) {
      throw new NotFoundException('No encontramos ese contenido.');
    }
    if (owner.userId === reporter.id) {
      throw new ConflictException('No puedes reportar tu propio contenido.');
    }

    const report = await this.sequelize
      .transaction(async (transaction) =>
        this.repository.createReport(
          {
            tenantId: reporter.tenantId,
            reporterUserId: reporter.id,
            reportedUserId: owner.userId,
            targetKind: input.targetKind,
            targetId: input.targetId,
            reason: input.reason,
            details: input.details,
          },
          transaction,
        ),
      )
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.name === 'SequelizeUniqueConstraintError'
        ) {
          throw new ConflictException('Ya reportaste esto; lo estamos revisando.');
        }
        throw error;
      });

    await this.distanceFromReportedUser(reporter.id, owner.userId);
    const autoHidden = await this.autoHideIfThresholdReached(
      input.targetKind,
      input.targetId,
      input.reason,
    );

    return {
      id: report.id,
      status: report.status,
      /** Se dice en la respuesta porque cambia lo que la interfaz debe contar. */
      contentHidden: autoHidden,
    };
  }

  /**
   * Denunciar implica dejar de verse.
   *
   * Se traga sus propios fallos: la denuncia YA está registrada y es lo que no
   * se puede perder. Que no se haya podido romper la conexión es molesto, no
   * motivo para devolver un error a quien acaba de reportar un acoso.
   */
  private async distanceFromReportedUser(
    reporterId: string,
    reportedUserId: string,
  ): Promise<void> {
    try {
      await this.sequelize.transaction(async (transaction) => {
        await this.passes.bulkCreate(
          [{ viewerId: reporterId, targetId: reportedUserId }] as never,
          { ignoreDuplicates: true, transaction },
        );
        await this.connections.update(
          { status: ConnectionStatus.REJECTED, respondedAt: new Date() },
          {
            where: {
              status: { [Op.ne]: ConnectionStatus.REJECTED },
              [Op.or]: [
                { requesterId: reporterId, addresseeId: reportedUserId },
                { requesterId: reportedUserId, addresseeId: reporterId },
              ],
            },
            transaction,
          },
        );
      });
    } catch (error) {
      this.logger.warn(
        {
          event: 'moderation.distance_failed',
          reporterId,
          reportedUserId,
          detail: error instanceof Error ? error.message : 'unknown',
        },
        ModerationService.name,
      );
    }
  }

  /** Cortina automática por acumulación de denunciantes distintos. */
  private async autoHideIfThresholdReached(
    targetKind: ModerationTargetKindValue,
    targetId: string,
    reason: ModerationReasonValue,
  ): Promise<boolean> {
    if (!isHideableTarget(targetKind)) return false;

    const reporters = await this.repository.countDistinctReporters(
      targetKind,
      targetId,
    );
    if (reporters < AUTO_HIDE_DISTINCT_REPORTERS) return false;

    await this.sequelize.transaction((transaction) =>
      this.repository.setContentHidden(
        {
          targetKind,
          targetId,
          hidden: true,
          // Lo oculta el sistema, no una persona: se deja SIN moderador. Un
          // identificador inventado violaría la clave foránea contra
          // `usuarios`, y uno real atribuiría a alguien una decisión que no
          // tomó.
          moderatorUserId: null,
          reason,
        },
        transaction,
      ),
    );
    this.logger.log(
      { event: 'moderation.auto_hidden', targetKind, targetId, reporters },
      ModerationService.name,
    );
    return true;
  }

  listQueue(actor: AuthenticatedUser, page: number, pageSize: number) {
    return this.repository.findQueue({
      tenantScope: actor.tenantScope,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
  }

  /**
   * El expediente completo de un caso.
   *
   * Incluye `pendingSanction`: qué castigo tocaría si se sanciona, calculado
   * ANTES de decidir. Enseñarlo es lo que convierte la escalera en una regla
   * conocida en vez de en una sorpresa — quien modera ve «esta persona ya tiene
   * dos avisos, la suspensión sería de 7 días» y decide con eso delante.
   */
  async getCase(
    actor: AuthenticatedUser,
    targetKind: ModerationTargetKindValue,
    targetId: string,
  ): Promise<CasePreview> {
    const reports = await this.repository.findReportsForTarget(
      targetKind,
      targetId,
      actor.tenantScope,
    );
    if (reports.length === 0) {
      throw new NotFoundException('No encontramos ese caso.');
    }

    const reportedUserId = reports[0].reportedUserId;
    const [activeStrikes, person, contentHidden] = await Promise.all([
      this.repository.countActiveStrikes(reportedUserId, new Date()),
      this.loadReportedPerson(reportedUserId),
      this.isContentHidden(targetKind, targetId),
    ]);
    const sanction = nextSanction(activeStrikes);

    return {
      targetKind,
      targetId,
      reportedUser: {
        id: reportedUserId,
        name: person.name,
        suspendedUntil: person.suspendedUntil?.toISOString() ?? null,
      },
      reports: reports.map((report) => ({
        id: report.id,
        reporterUserId: report.reporterUserId,
        reason: report.reason,
        details: report.details,
        createdAt: report.createdAt.toISOString(),
        status: report.status,
      })),
      activeStrikes,
      pendingSanction: { kind: sanction.kind, days: sanction.days },
      contentHidden,
    };
  }

  private async loadReportedPerson(
    userId: string,
  ): Promise<{ name: string; suspendedUntil: Date | null }> {
    const [row] = await this.sequelize.query<{
      name: string;
      suspendedUntil: Date | null;
    }>(
      `SELECT nombre_completo AS "name", suspended_until AS "suspendedUntil"
         FROM public.usuarios WHERE id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row ?? { name: 'Cuenta eliminada', suspendedUntil: null };
  }

  private async isContentHidden(
    targetKind: ModerationTargetKindValue,
    targetId: string,
  ): Promise<boolean> {
    if (!isHideableTarget(targetKind)) return false;
    const table =
      targetKind === ModerationTargetKind.STORY ? 'profile.stories' : 'profile.photos';
    const [row] = await this.sequelize.query<{ hidden: boolean }>(
      `SELECT (hidden_at IS NOT NULL) AS hidden FROM ${table} WHERE id = :targetId`,
      { type: QueryTypes.SELECT, replacements: { targetId } },
    );
    return row?.hidden ?? false;
  }

  async claim(
    actor: AuthenticatedUser,
    targetKind: ModerationTargetKindValue,
    targetId: string,
  ) {
    const affected = await this.repository.claim(
      targetKind,
      targetId,
      actor.id,
      actor.tenantScope,
    );
    if (affected === 0) {
      throw new ConflictException(
        'Otra persona ya está revisando este caso. Actualiza la cola.',
      );
    }
    return { claimed: true, reports: affected };
  }

  async release(
    actor: AuthenticatedUser,
    targetKind: ModerationTargetKindValue,
    targetId: string,
  ) {
    const affected = await this.repository.release(
      targetKind,
      targetId,
      actor.id,
      actor.tenantScope,
    );
    if (affected === 0) {
      throw new ConflictException('Este caso no estaba asignado a ti.');
    }
    return { released: true };
  }

  /**
   * El veredicto.
   *
   * Todo ocurre en UNA transacción —ocultar, sancionar, suspender, cerrar las
   * quejas— porque un veredicto a medias es peor que ninguno: contenido oculto
   * sin sanción registrada, o una suspensión sin el caso cerrado, dejan el
   * sistema diciendo dos cosas distintas sobre lo mismo.
   *
   * Las notificaciones salen DESPUÉS del commit: avisar a alguien de una
   * sanción que luego se deshizo no se puede retirar.
   */
  async resolve(
    actor: AuthenticatedUser,
    targetKind: ModerationTargetKindValue,
    targetId: string,
    input: ResolveCaseInput,
  ) {
    const openReports = await this.repository.findOpenReportsForTarget(
      targetKind,
      targetId,
      actor.tenantScope,
    );
    if (openReports.length === 0) {
      throw new NotFoundException('Este caso ya no está abierto.');
    }

    const first = openReports[0];
    const reportedUserId = first.reportedUserId;
    const tenantId = first.tenantId;
    const now = new Date();

    let sanction: Sanction | null = null;

    await this.sequelize.transaction(async (transaction) => {
      if (input.sanction) {
        const previous = await this.repository.countActiveStrikes(
          reportedUserId,
          now,
          transaction,
        );
        sanction = nextSanction(previous, now);

        await this.repository.createStrike(
          {
            userId: reportedUserId,
            tenantId,
            kind: sanction.kind,
            reason: first.reason,
            note: input.note,
            targetKind,
            targetId,
            issuedByUserId: actor.id,
            suspendedUntil: sanction.suspendedUntil,
            expiresAt: strikeExpiryFrom(now),
          },
          transaction,
        );

        if (sanction.kind === StrikeKind.SUSPENSION) {
          await this.repository.setSuspension(
            reportedUserId,
            sanction.suspendedUntil,
            transaction,
          );
        }
        if (sanction.kind === StrikeKind.EXPULSION) {
          // La expulsión no es una fecha lejana: es dar de baja la cuenta. Un
          // `suspended_until` en el año 2099 sería una mentira que algún día
          // caduca.
          await this.sequelize.query(
            `UPDATE public.usuarios SET estado = 'INACTIVO' WHERE id = :userId`,
            { replacements: { userId: reportedUserId }, transaction },
          );
        }
      }

      if (isHideableTarget(targetKind)) {
        await this.repository.setContentHidden(
          {
            targetKind,
            targetId,
            hidden: input.hideContent,
            moderatorUserId: actor.id,
            reason: first.reason,
          },
          transaction,
        );
      }

      await this.repository.resolveTarget(
        {
          targetKind,
          targetId,
          resolution: this.resolutionFor(input, sanction),
          note: input.note,
          moderatorUserId: actor.id,
          discarded: !input.sanction && !input.hideContent,
          tenantScope: actor.tenantScope,
        },
        transaction,
      );
    });

    await this.notifyOutcome(openReports, reportedUserId, sanction, input);

    return {
      resolved: true,
      reportsClosed: openReports.length,
      sanction: sanction
        ? { kind: (sanction as Sanction).kind, days: (sanction as Sanction).days }
        : null,
      contentHidden: isHideableTarget(targetKind) ? input.hideContent : false,
    };
  }

  private resolutionFor(
    input: ResolveCaseInput,
    sanction: Sanction | null,
  ): ModerationResolutionValue {
    if (sanction) return sanction.resolution;
    if (input.hideContent) return ModerationResolution.CONTENIDO_OCULTO;
    return ModerationResolution.SIN_ACCION;
  }

  /**
   * Cierra el círculo con las dos partes.
   *
   * A quien denunció: «lo revisamos». Sin esto, denunciar se siente como
   * escribir a un buzón que no contesta, y la gente deja de hacerlo — que es la
   * forma más barata de quedarse sin moderación.
   *
   * A quien fue sancionado: qué pasó y por cuánto tiempo. Una suspensión sin
   * explicación se vive como un fallo de la aplicación.
   *
   * Nada de esto puede tumbar la resolución, que ya está confirmada en base de
   * datos: los fallos se registran y se siguen.
   */
  private async notifyOutcome(
    reports: { id: string; reporterUserId: string }[],
    reportedUserId: string,
    sanction: Sanction | null,
    input: ResolveCaseInput,
  ): Promise<void> {
    const tasks: Promise<unknown>[] = reports.map((report) =>
      this.notifications.enqueueDirectMessage({
        recipientUserId: report.reporterUserId,
        channel: NotificationChannel.IN_APP,
        subject: 'Revisamos tu reporte',
        body: input.hideContent
          ? 'Gracias por avisar. Revisamos el contenido que reportaste y lo retiramos.'
          : 'Gracias por avisar. Revisamos el contenido que reportaste.',
        deduplicationKey: `moderation.report-reviewed:${report.id}`,
      }),
    );

    if (sanction) {
      tasks.push(
        this.notifications.enqueueDirectMessage({
          recipientUserId: reportedUserId,
          channel: NotificationChannel.IN_APP,
          subject: this.sanctionSubject(sanction),
          body: this.sanctionBody(sanction),
          deduplicationKey: `moderation.sanction:${reportedUserId}:${Date.now()}`,
        }),
      );
    }

    const results = await Promise.allSettled(tasks);
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(
        { event: 'moderation.notify_failed', failed, total: results.length },
        ModerationService.name,
      );
    }
  }

  private sanctionSubject(sanction: Sanction): string {
    if (sanction.kind === StrikeKind.ADVERTENCIA) return 'Aviso sobre tu contenido';
    if (sanction.kind === StrikeKind.EXPULSION) return 'Tu cuenta ha sido cerrada';
    return 'Tu cuenta ha sido suspendida';
  }

  private sanctionBody(sanction: Sanction): string {
    if (sanction.kind === StrikeKind.ADVERTENCIA) {
      return 'Retiramos contenido tuyo por incumplir las normas de la comunidad. Es un aviso: si vuelve a ocurrir, tu cuenta puede quedar suspendida.';
    }
    if (sanction.kind === StrikeKind.EXPULSION) {
      return 'Cerramos tu cuenta por incumplimientos repetidos de las normas de la comunidad.';
    }
    const days = sanction.days ?? 0;
    return `Suspendimos tu cuenta ${days === 1 ? 'un día' : `${days} días`} por incumplir las normas de la comunidad. Podrás volver a entrar cuando termine.`;
  }

  /** Historial de una persona, para la ficha y para decidir con contexto. */
  async historyFor(actor: AuthenticatedUser, userId: string) {
    const owner = await this.repository.findContentOwner(
      ModerationTargetKind.USER,
      userId,
    );
    if (!owner || (actor.tenantScope && owner.tenantId !== actor.tenantScope)) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const [strikes, activeStrikes] = await Promise.all([
      this.repository.listStrikes(userId),
      this.repository.countActiveStrikes(userId, new Date()),
    ]);
    return {
      activeStrikes,
      nextSanction: nextSanction(activeStrikes).kind,
      strikes: strikes.map((strike) => ({
        id: strike.id,
        kind: strike.kind,
        reason: strike.reason,
        note: strike.note,
        suspendedUntil: strike.suspendedUntil?.toISOString() ?? null,
        expiresAt: strike.expiresAt.toISOString(),
        createdAt: strike.createdAt.toISOString(),
        /** Ya no pesa en la escalera, pero sigue siendo historial. */
        expired: strike.expiresAt.getTime() <= Date.now(),
      })),
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BusinessDateService } from '../../common/time/business-date.service';
import { RewardLedgerRepository } from './reward-ledger.repository';
import { ProgramWeekCloseService } from './program-week-close.service';
import { ProgramsRepository } from './programs.repository';
import { ProgramsQueryService } from './programs-query.service';

/** Vista de soporte (RF-B3): ver el entrenamiento de un socio sin tocar SQL y arreglar un cierre sin bajar puntos. */
@Injectable()
export class SupportTrainingService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly programs: ProgramsRepository,
    private readonly ledger: RewardLedgerRepository,
    private readonly query: ProgramsQueryService,
    private readonly close: ProgramWeekCloseService,
    private readonly dates: BusinessDateService,
  ) {}

  async trainingOf(userId: string, tenantScope: string | null) {
    await this.assertInScope(userId, tenantScope);
    const programRows = await this.sequelize.query<{ id: string }>(
      `SELECT id FROM training.training_programs WHERE usuario_id = :userId ORDER BY created_at DESC LIMIT 20`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const programs = [];
    for (const { id } of programRows) {
      const program = await this.programs.findById(id);
      if (!program) continue;
      programs.push({
        ...(await this.query.view(program)),
        semanas: (await this.programs.listWeeks(id)).map((w) => ({
          numero: w.weekNumber,
          inicio: w.weekStart,
          esDescarga: w.isDeload,
          sesionesPlan: w.sessionsPlan,
          sesionesHechas: w.sessionsDone,
          cardioMinutos: w.cardioMinutes,
          cumplida: w.fulfilled,
          multiplicador: w.multiplier == null ? null : Number(w.multiplier),
          cerradaEn: w.closedAt,
        })),
        bonos: await this.ledger.listForProgram(id),
      });
    }
    const [routines] = await this.sequelize.query<{ total: number; publicas: number; ocultas: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE visibilidad = 'PUBLIC')::int AS publicas,
              count(*) FILTER (WHERE estado_moderacion <> 'VISIBLE')::int AS ocultas
         FROM training.routines WHERE created_by_user_id = :userId AND estado = 'ACTIVE'`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const invitations = await this.sequelize.query(
      `SELECT s.id, s.estado, s.origen, s.created_at AS "creadaEn", r.nombre AS "rutinaNombre", o.nombre_completo AS "deParte"
         FROM training.routine_shares s
         JOIN training.routines r ON r.id = s.routine_id
         JOIN public.usuarios o ON o.id = s.propietario_id
        WHERE s.invitado_id = :userId ORDER BY s.created_at DESC LIMIT 20`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const sessions = await this.sequelize.query(
      `SELECT s.id, s.fecha_inicio AS "inicio", s.fecha_fin AS "fin", s.estado, s.program_id AS "programaId",
              (SELECT count(*)::int FROM public.sesiones_ejercicios se
                 JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id WHERE se.sesion_id = s.id) AS series
         FROM public.sesiones_entrenamiento s WHERE s.usuario_id = :userId ORDER BY s.fecha_inicio DESC LIMIT 10`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return {
      usuarioId: userId,
      puntosDeModo: await this.ledger.totalBonus(userId),
      rutinas: routines,
      programas: programs,
      invitaciones: invitations,
      ultimasSesiones: sessions,
    };
  }

  /**
   * Recalcula UNA semana ya cerrada. Idempotente y solo hacia arriba: si ahora
   * resulta cumplida y antes no, otorga el bono que faltaba; nunca resta puntos
   * ni toca las semanas posteriores.
   */
  async recomputeWeek(
    programId: string,
    weekNumber: number,
    tenantScope: string | null,
    today: string = this.dates.today(),
  ) {
    const program = await this.programs.findById(programId);
    if (!program) throw new NotFoundException('Programa no encontrado.');
    await this.assertInScope(program.userId, tenantScope);
    return this.close.recomputeWeek(programId, weekNumber, today);
  }

  /**
   * Ejecuta el cierre semanal de UN programa a mano (el mismo código que el
   * trabajo del lunes). `until` permite probar con una fecha futura; sin él
   * usa hoy. Idempotente: el libro rechaza el doble pago.
   */
  async closeWeeksNow(programId: string, tenantScope: string | null, until?: string) {
    const program = await this.programs.findById(programId);
    if (!program) throw new NotFoundException('Programa no encontrado.');
    await this.assertInScope(program.userId, tenantScope);
    const closed = await this.close.closeProgram(programId, until ?? this.dates.today());
    return { cerradas: closed };
  }

  private async assertInScope(userId: string, tenantScope: string | null): Promise<void> {
    const [row] = await this.sequelize.query<{ tenant: string }>(
      `SELECT tenant_id AS tenant FROM public.usuarios WHERE id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    // Un socio de otro gimnasio responde igual que uno inexistente.
    if (!row || (tenantScope !== null && row.tenant !== tenantScope)) {
      throw new NotFoundException('Usuario no encontrado.');
    }
  }
}

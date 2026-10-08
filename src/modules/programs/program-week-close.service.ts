import { env } from '../../config/env';
import { Injectable, Logger } from '@nestjs/common';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { RoutineAssignmentStatus } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { ProductEvents } from '../../common/tracking/product-events';
import { RoutineNotifier } from '../training/routine-notifier';
import { TrainingRepository } from '../training/training.repository';
import { CardioPlanModel } from './cardio-plan.model';
import { InjectModel } from '@nestjs/sequelize';
import { isCardioWeekFulfilled, targetMinutesForWeek } from './engine/cardio';
import { addDays, mondayOf } from './engine/program-calendar';
import { sessionBasePoints } from './engine/session-diff';
import {
  BONUS_PROGRAM_COMPLETED,
  isProgramCompleted,
  isWeekFulfilled,
  nextMultiplier,
  weekBonus,
} from './engine/week-close';
import { ProgramWeekModel, TrainingProgramModel } from './program.models';
import { ProgramsRepository } from './programs.repository';
import { RewardLedgerRepository } from './reward-ledger.repository';

export type WeekCloseResult = { programId: string; weekNumber: number; fulfilled: boolean | null; multiplier: number; bonus: number };

/**
 * Cierre semanal (04_MOTOR §5). Idempotente por (programa, semana): bloquea el
 * programa, revisa que la semana siga abierta y el libro rechaza el doble pago.
 * Si el trabajo se cae un lunes, la siguiente pasada cierra TODAS las semanas
 * pendientes en orden (caso límite 10).
 */
@Injectable()
export class ProgramWeekCloseService {
  private readonly logger = new Logger(ProgramWeekCloseService.name);

  constructor(
    private readonly programs: ProgramsRepository,
    private readonly ledger: RewardLedgerRepository,
    private readonly routines: TrainingRepository,
    private readonly notifier: RoutineNotifier,
    private readonly dates: BusinessDateService,
    private readonly events: ProductEvents,
    private readonly sequelize: Sequelize,
    @InjectModel(CardioPlanModel) private readonly cardioPlans: typeof CardioPlanModel,
  ) {}

  /** Cierra todo lo que haya vencido. Devuelve lo cerrado, para el registro y las pruebas. */
  async closeDueWeeks(today: string = this.dates.today()): Promise<WeekCloseResult[]> {
    const results: WeekCloseResult[] = [];
    for (const program of await this.programs.listActive()) {
      try {
        results.push(...(await this.closeProgram(program.id, today)));
      } catch (error: unknown) {
        // Un programa roto no debe impedir cerrar los demás.
        this.logger.error({
          event: 'program_week_close.failed',
          programId: program.id,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** Cierra las semanas vencidas de UN programa y, si acabó, el programa. */
  async closeProgram(programId: string, today: string = this.dates.today()): Promise<WeekCloseResult[]> {
    const thisMonday = mondayOf(today);
    const results: WeekCloseResult[] = [];
    const open = await this.programs.listOpenWeeksEndingBefore(programId, thisMonday);
    for (const week of open) {
      const result = await this.sequelize.transaction((t) => this.closeWeek(programId, week.weekNumber, t));
      if (result) results.push(result);
    }
    await this.finishIfOver(programId, today);
    return results;
  }

  private async closeWeek(programId: string, weekNumber: number, transaction: Transaction): Promise<WeekCloseResult | null> {
    const program = await TrainingProgramModel.findByPk(programId, { transaction, lock: transaction.LOCK.UPDATE });
    const week = await ProgramWeekModel.findOne({ where: { programId, weekNumber }, transaction, lock: transaction.LOCK.UPDATE });
    if (!program || !week || week.fulfilled !== null || week.closedAt) return null;

    const weekEnd = addDays(week.weekStart, 6);
    // Una semana sin sesiones planeadas (p. ej. el programa empezó el domingo) no se paga ni se penaliza.
    if (week.sessionsPlan <= 0) {
      await week.update({ closedAt: new Date() }, { transaction });
      return { programId, weekNumber, fulfilled: null, multiplier: Number(program.multiplier), bonus: 0 };
    }

    const stats = await this.weekStats(programId, week.weekStart, weekEnd, transaction);
    const fulfilled =
      program.lane === 'CARDIO'
        ? await this.cardioFulfilled(program, week)
        : week.isDeload && stats.sessions >= week.sessionsPlan
          ? true
          : isWeekFulfilled({
              sessionsPlan: week.sessionsPlan,
              sessionsDone: week.sessionsDone,
              workRatio: await this.workRatio(programId, week.weekStart, weekEnd, transaction),
            });

    let multiplier = Number(program.multiplier);
    let bonus = 0;
    if (program.mode !== 'NONE') {
      multiplier = nextMultiplier(multiplier, fulfilled);
      if (fulfilled) {
        const base = program.lane === 'CARDIO' ? week.sessionsDone * 50 + week.cardioMinutes : stats.basePoints;
        bonus = weekBonus(base, multiplier);
        await this.ledger.append(
          { userId: program.userId, programId, weekNumber, multiplier, basePoints: base, bonusPoints: bonus, reason: 'SEMANA_CUMPLIDA' },
          transaction,
        );
      }
      await program.update({ multiplier: multiplier.toFixed(2) }, { transaction });
    }
    await week.update({ fulfilled, multiplier: multiplier.toFixed(2), closedAt: new Date() }, { transaction });

    if (program.mode !== 'NONE') {
      await this.notifier
        .notify({
          to: program.userId,
          type: 'PROGRAM_WEEK_CLOSED',
          subject: fulfilled ? 'Semana cumplida' : 'Nueva semana, nuevo comienzo',
          body: fulfilled
            ? `Semana ${weekNumber} cumplida · multiplicador x${multiplier.toFixed(1).replace('.', ',')}`
            : `Semana ${weekNumber} sin completar: el multiplicador vuelve a x1,0. Tus puntos no se pierden.`,
          dedupeKey: `${programId}:${weekNumber}`,
          refs: { programId, weekNumber },
        })
        .catch(() => false);
    }
    this.events.emit('program_week_closed', { program_id: programId, semana: weekNumber, cumplida: fulfilled, multiplicador: multiplier, bonus });
    return { programId, weekNumber, fulfilled, multiplier, bonus };
  }

  /**
   * Soporte: reevalúa una semana ya cerrada. Solo puede AÑADIR el bono que
   * faltaba (nunca quita puntos ni cambia otras semanas) y es idempotente.
   */
  async recomputeWeek(programId: string, weekNumber: number, today: string) {
    return this.sequelize.transaction(async (transaction) => {
      const program = await TrainingProgramModel.findByPk(programId, { transaction, lock: transaction.LOCK.UPDATE });
      const week = await ProgramWeekModel.findOne({ where: { programId, weekNumber }, transaction, lock: transaction.LOCK.UPDATE });
      if (!program || !week) return { recalculada: false, motivo: 'SEMANA_NO_ENCONTRADA' as const };
      if (week.weekStart >= mondayOf(today)) return { recalculada: false, motivo: 'SEMANA_ABIERTA' as const };
      if (week.fulfilled === true) return { recalculada: false, motivo: 'YA_CUMPLIDA' as const };

      const stats = await this.weekStats(programId, week.weekStart, addDays(week.weekStart, 6), transaction);
      const fulfilled =
        program.lane === 'CARDIO'
          ? await this.cardioFulfilled(program, week)
          : isWeekFulfilled({
              sessionsPlan: week.sessionsPlan,
              sessionsDone: Math.max(week.sessionsDone, stats.sessions),
              workRatio: await this.workRatio(programId, week.weekStart, addDays(week.weekStart, 6), transaction),
            });
      if (!fulfilled) return { recalculada: false, motivo: 'SIGUE_SIN_CUMPLIR' as const };

      const previous = await ProgramWeekModel.findOne({ where: { programId, weekNumber: weekNumber - 1 }, transaction });
      const multiplier = nextMultiplier(previous?.multiplier == null ? 1 : Number(previous.multiplier), true);
      const bonus = program.mode === 'NONE' ? 0 : weekBonus(stats.basePoints, multiplier);
      if (program.mode !== 'NONE') {
        await this.ledger.append(
          { userId: program.userId, programId, weekNumber, multiplier, basePoints: stats.basePoints, bonusPoints: bonus, reason: 'SEMANA_CUMPLIDA' },
          transaction,
        );
      }
      await week.update({ fulfilled: true, multiplier: multiplier.toFixed(2), sessionsDone: Math.max(week.sessionsDone, stats.sessions) }, { transaction });
      return { recalculada: true, motivo: 'CUMPLIDA' as const, multiplicador: multiplier, bono: bonus };
    });
  }

  /** Si ya pasó el fin y todas las semanas están cerradas, el programa termina (+500 si ≥ 75 % cumplidas). */
  private async finishIfOver(programId: string, today: string): Promise<void> {
    const program = await this.programs.findById(programId);
    if (!program || program.status !== 'ACTIVE' || today <= program.plannedEndDate) return;
    const weeks = await this.programs.listWeeks(programId);
    if (weeks.some((w) => w.closedAt === null)) return;
    const counted = weeks.filter((w) => w.fulfilled !== null);
    const fulfilledCount = counted.filter((w) => w.fulfilled).length;
    const completed = program.mode !== 'NONE' && isProgramCompleted(fulfilledCount, counted.length);

    await this.sequelize.transaction(async (transaction) => {
      await this.programs.closeProgram(program, 'FINISHED', 'COMPLETED', transaction);
      if (program.assignmentId) {
        await this.routines.setAssignmentStatus(program.assignmentId, RoutineAssignmentStatus.CANCELLED, transaction);
      }
      if (completed) {
        await this.ledger.append(
          { userId: program.userId, programId, weekNumber: weeks.length + 1, multiplier: Number(program.multiplier), basePoints: 0, bonusPoints: BONUS_PROGRAM_COMPLETED, reason: 'PROGRAMA_COMPLETADO' },
          transaction,
        );
      }
    });
    await this.notifier
      .notify({
        to: program.userId,
        type: 'PROGRAM_FINISHED',
        subject: 'Terminaste tu programa',
        body: '¡Terminaste tu programa! ¿Qué sigue?',
        dedupeKey: programId,
        refs: { programId },
      })
      .catch(() => false);
  }

  private async cardioFulfilled(program: TrainingProgramModel, week: ProgramWeekModel): Promise<boolean> {
    const plan = program.cardioPlanId ? await this.cardioPlans.findByPk(program.cardioPlanId) : null;
    if (!plan) return false;
    return isCardioWeekFulfilled({
      countedMinutes: week.cardioMinutes,
      targetMinutesPerSession: targetMinutesForWeek(plan.targetMinutes, plan.weeklyProgressionPct, week.weekNumber),
      sessionsPlan: week.sessionsPlan,
    });
  }

  /** Sesiones de fuerza que cuentan y los puntos base de la semana (fórmula de la Senda). */
  private async weekStats(programId: string, from: string, to: string, transaction: Transaction) {
    const rows = await this.sequelize.query<{ sets: number; kg: string }>(
      `SELECT count(st.id)::int AS sets, COALESCE(sum(st.peso_kg * st.repeticiones), 0) AS kg
         FROM public.sesiones_entrenamiento s
         JOIN public.sesiones_ejercicios se ON se.sesion_id = s.id
         JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id AND st.tipo_serie = 'FUERZA'
        WHERE s.program_id = :programId AND s.estado = 'FINALIZADA'
          AND (s.fecha_fin AT TIME ZONE :tz)::date BETWEEN :from::date AND :to::date
        GROUP BY s.id`,
      { type: QueryTypes.SELECT, replacements: { programId, from, to, tz: env.BUSINESS_TIME_ZONE }, transaction },
    );
    const qualifying = rows.filter((r) => r.sets >= 3);
    return {
      sessions: qualifying.length,
      basePoints: qualifying.reduce((sum, r) => sum + sessionBasePoints(r.sets, Number(r.kg)), 0),
    };
  }

  /** Fracción de levantamientos objetivo con al menos una serie esa semana (≥ 80 % → semana cumplida). */
  private async workRatio(programId: string, from: string, to: string, transaction: Transaction): Promise<number> {
    const [row] = await this.sequelize.query<{ total: number; worked: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM public.sesiones_entrenamiento s
                  JOIN public.sesiones_ejercicios se ON se.sesion_id = s.id AND se.ejercicio_id = t.ejercicio_id
                  JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id AND st.tipo_serie = 'FUERZA'
                 WHERE s.program_id = t.program_id AND s.estado = 'FINALIZADA'
                   AND (s.fecha_fin AT TIME ZONE :tz)::date BETWEEN :from::date AND :to::date))::int AS worked
         FROM training.program_lift_targets t WHERE t.program_id = :programId`,
      { type: QueryTypes.SELECT, replacements: { programId, from, to, tz: env.BUSINESS_TIME_ZONE }, transaction },
    );
    // Sin levantamientos definidos (modo NONE) basta con haber hecho las sesiones.
    return !row || row.total === 0 ? 1 : row.worked / row.total;
  }
}

import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { DomainException } from '../../common/errors/domain.exception';
import { BusinessDateService } from '../../common/time/business-date.service';
import { SessionFinishedContext, SessionHooksRegistry } from '../workouts/session-hooks';
import { WorkoutsRepository } from '../workouts/workouts.repository';
import { CardioPlansService } from './cardio-plans.service';
import { CardioPlanModel } from './cardio-plan.model';
import { concurrentAdvice, countedMinutes, IntensityTarget, targetMinutesForWeek } from './engine/cardio';
import { plannedEnd, programWeeks, sessionsPlannedInWeek, weekNumberOn } from './engine/program-calendar';
import { ProgramView } from './program-view';
import { ProgramsQueryService } from './programs-query.service';
import { ProgramsRepository } from './programs.repository';
import { ActivateCardioInput } from './cardio.schemas';

type Actor = { id: string };

/** Programa de cardio: segundo carril, convive con el de pesas (RF-17, respuesta 4). */
@Injectable()
export class ProgramsCardioService implements OnModuleInit {
  constructor(
    private readonly programs: ProgramsRepository,
    private readonly plans: CardioPlansService,
    private readonly query: ProgramsQueryService,
    private readonly hooks: SessionHooksRegistry,
    private readonly workouts: WorkoutsRepository,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  onModuleInit(): void {
    this.hooks.register('cardio', (context) => this.onFinished(context));
  }

  async activate(actor: Actor, input: ActivateCardioInput): Promise<ProgramView> {
    const plan = input.planId ? await this.plans.owned(actor.id, input.planId) : await this.createInline(actor.id, input);
    const today = this.dates.today();
    const startDate = input.startDate ?? today;
    if (startDate < today) throw new BadRequestException('La fecha de inicio no puede estar en el pasado.');
    const endDate = plannedEnd(startDate, input.durationWeeks);

    try {
      const programId = await this.sequelize.transaction(async (transaction) => {
        const active = await this.programs.findActive(actor.id, 'CARDIO', transaction);
        if (active) {
          if (!input.replace) throw this.conflict(await this.query.summaryOf(active));
          await this.programs.closeProgram(active, 'STOPPED', 'REPLACED', transaction);
        }
        const program = await this.programs.createProgram(
          {
            userId: actor.id,
            lane: 'CARDIO',
            mode: 'CARDIO',
            cardioPlanId: plan.id,
            config: { weekdays: plan.weekdays, durationWeeks: input.durationWeeks },
            startDate,
            plannedEndDate: endDate,
            status: 'ACTIVE',
            multiplier: '1.00',
          },
          transaction,
        );
        await this.programs.createWeeks(
          programWeeks(startDate, endDate).map((w) => ({
            programId: program.id,
            weekNumber: w.number,
            weekStart: w.startDate,
            isDeload: false,
            sessionsPlan: sessionsPlannedInWeek(w, plan.weekdays, startDate, endDate),
            sessionsDone: 0,
            cardioMinutes: 0,
          })),
          transaction,
        );
        return program.id;
      });
      return this.query.viewById(programId);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
        const active = await this.programs.findActive(actor.id, 'CARDIO');
        if (active) throw this.conflict(await this.query.summaryOf(active));
      }
      throw error;
    }
  }

  private conflict(summary: Record<string, unknown>): DomainException {
    return new DomainException(409, 'PROGRAM_ACTIVE_CONFLICT', 'Ya tienes un programa de cardio activo.', { activeProgram: summary });
  }

  private async createInline(userId: string, input: ActivateCardioInput): Promise<CardioPlanModel> {
    if (!input.plan) throw new BadRequestException('Falta el plan de cardio.');
    const view = await this.plans.create(userId, input.plan);
    return this.plans.owned(userId, view.id);
  }

  /** Suma los minutos de cardio de la sesión que acaba de terminar a la semana en curso. */
  async onFinished({ session: finished, userId }: SessionFinishedContext): Promise<Record<string, unknown> | null> {
    const program = await this.programs.findActive(userId, 'CARDIO');
    if (!program?.cardioPlanId) return null;
    const session = await this.workouts.findSessionByIdForUser(finished.id, userId);
    const sets = (session?.sessionExercises ?? []).flatMap((se) => (se.sets ?? []).filter((s) => s.type === 'CARDIO'));
    if (sets.length === 0) return null;

    const plan = await CardioPlanModel.findByPk(program.cardioPlanId);
    if (!plan) return null;
    const today = this.dates.today();
    const weekNumber = weekNumberOn(today, program.startDate, program.plannedEndDate);
    const week = weekNumber ? await this.programs.findWeek(program.id, weekNumber) : null;

    const target: IntensityTarget =
      plan.intensityType === 'ZONA_FC' ? { type: 'ZONA_FC', zone: plan.targetZone ?? 2 } : { type: 'RPE', rpe: plan.targetRpe ?? 5 };
    const hr = { max: plan.maxHeartRate ?? 190, rest: plan.restingHeartRate };
    const counted = sets.reduce(
      (sum, s) => sum + countedMinutes({ durationSeconds: s.durationSeconds ?? 0, avgHeartRate: s.avgHeartRate, rpe: s.rpe }, target, hr),
      0,
    );
    const totalMinutes = sets.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0) / 60;
    const qualifies = totalMinutes >= 10;
    const before = week?.cardioMinutes ?? 0;

    if (week && qualifies) {
      await week.update({ cardioMinutes: before + Math.round(counted), sessionsDone: week.sessionsDone + 1 });
    }
    const perSession = targetMinutesForWeek(plan.targetMinutes, plan.weeklyProgressionPct, weekNumber ?? 1);
    return {
      cardio: {
        programId: program.id,
        semana: weekNumber,
        sesionCuenta: qualifies,
        minutosCuentan: Math.round(counted),
        minutosSemana: before + (qualifies ? Math.round(counted) : 0),
        objetivoMinutosSemana: perSession * (week?.sessionsPlan ?? plan.weekdays.length),
        objetivoMinutosSesion: perSession,
        cumpleObjetivoSesion: counted >= perSession,
        consejo: concurrentAdvice({ sameDayWithWeights: false, lowerBodyDay: false, modality: plan.modality, minutes: totalMinutes }),
      },
    };
  }
}

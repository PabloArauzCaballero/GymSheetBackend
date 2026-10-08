import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { RoutineAssignmentStatus, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { BusinessDateService } from '../../common/time/business-date.service';
import { RoutineAccessService } from '../training/routine-access.service';
import { RoutinePublicationService } from '../training/routine-publication.service';
import { TrainingRepository } from '../training/training.repository';
import { generateWeeks } from './engine/week-generation';
import { goalWeek } from './engine/strength-goals';
import {
  isoToAgendaDay,
  plannedEnd,
  programWeeks,
  sessionsPlannedInWeek,
} from './engine/program-calendar';
import { buildLiftTargets } from './program-lifts';
import { ProgramView } from './program-view';
import { ProgramsQueryService } from './programs-query.service';
import { ProgramsRepository } from './programs.repository';
import { ActivateStrengthInput } from './programs.schemas';
import { TrainingProgramModel } from './program.models';

type Actor = { id: string; role: UserRole; tenantId: string };

/** Activar un programa de fuerza: reemplazo atómico, copia privada de rutinas ajenas y agenda (RF-14). */
@Injectable()
export class ProgramsActivationService {
  constructor(
    private readonly programs: ProgramsRepository,
    private readonly routines: TrainingRepository,
    private readonly access: RoutineAccessService,
    private readonly publication: RoutinePublicationService,
    private readonly query: ProgramsQueryService,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  async activateStrength(actor: Actor, input: ActivateStrengthInput): Promise<ProgramView> {
    const source = await this.routines.findRoutineById(input.routineId);
    if (!source) throw new NotFoundException('Rutina no encontrada.');
    await this.access.assertFullView(actor, source);

    // DD-1: nadie ejecuta la rutina de otra persona; se activa una copia suya.
    const routineId = source.createdByUserId === actor.id ? source.id : (await this.publication.copy(actor, source.id)).id;
    const routine = await this.routines.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    this.assertHasWork(routine);

    const today = this.dates.today();
    const startDate = input.startDate ?? today;
    if (startDate < today) throw new BadRequestException('La fecha de inicio no puede estar en el pasado.');
    const durationWeeks = input.durationWeeks ?? routine.durationWeeks ?? 4;
    const endDate = plannedEnd(startDate, durationWeeks);
    const isoDays = input.weekdays ?? (routine.days ?? []).map((d) => d.weekday).filter((d): d is number => d !== null);
    if (isoDays.length === 0) throw new BadRequestException('Elige los días de la semana en que vas a entrenar.');

    const lifts = buildLiftTargets({ routine, mode: input.mode, requested: input.liftTargets, startDate });
    const deloadByWeek = this.deloadWeeks(routine, input.mode, durationWeeks);
    const spans = programWeeks(startDate, endDate);

    try {
      const programId = await this.sequelize.transaction(async (transaction) => {
        const active = await this.programs.findActive(actor.id, 'STRENGTH', transaction);
        if (active) {
          if (!input.replace) throw await this.conflict(active);
          await this.stopForReplacement(active, transaction);
        }
        const assignment = await this.routines.upsertSelfAssignment(
          routine.id,
          actor.id,
          { weekdays: isoDays.map(isoToAgendaDay), repeatsFrom: startDate, repeatsUntil: endDate },
          transaction,
        );
        const program = await this.programs.createProgram(
          {
            userId: actor.id,
            lane: 'STRENGTH',
            mode: input.mode,
            routineId: routine.id,
            assignmentId: assignment.id,
            config: { weekdays: isoDays, durationWeeks },
            startDate,
            plannedEndDate: endDate,
            status: 'ACTIVE',
            multiplier: '1.00',
          },
          transaction,
        );
        await this.programs.createLifts(lifts.map((l) => ({ ...l, programId: program.id })), transaction);
        await this.programs.createWeeks(
          spans.map((w) => ({
            programId: program.id,
            weekNumber: w.number,
            weekStart: w.startDate,
            isDeload: deloadByWeek.has(w.number),
            sessionsPlan: sessionsPlannedInWeek(w, isoDays, startDate, endDate),
            sessionsDone: 0,
            cardioMinutes: 0,
          })),
          transaction,
        );
        await routine.increment('activationsCount', { transaction });
        return program.id;
      });
      return this.query.viewById(programId);
    } catch (error: unknown) {
      // Dos activaciones a la vez: el índice único deja pasar una y la otra recibe el mismo 409.
      if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
        const active = await this.programs.findActive(actor.id, 'STRENGTH');
        if (active) throw await this.conflict(active);
      }
      throw error;
    }
  }

  private deloadWeeks(routine: NonNullable<Awaited<ReturnType<TrainingRepository['findRoutineById']>>>, mode: string, weeks: number) {
    const set = new Set<number>();
    if (mode === 'STRENGTH_GOALS') {
      for (let n = 1; n <= weeks; n += 1) if (goalWeek(n).isDeload) set.add(n);
      return set;
    }
    for (const w of generateWeeks({ days: [], durationWeeks: weeks, progression: routine.progressionConfig })) {
      if (w.esDescarga) set.add(w.numero);
    }
    return set;
  }

  private assertHasWork(routine: { days?: unknown[]; exercises?: unknown[] }): void {
    if (!routine.days?.length || !routine.exercises?.length) {
      throw new DomainException(400, 'ROUTINE_HAS_NO_DAYS', 'La rutina necesita al menos un día con ejercicios.');
    }
  }

  private async conflict(active: TrainingProgramModel): Promise<DomainException> {
    return new DomainException(409, 'PROGRAM_ACTIVE_CONFLICT', 'Ya tienes un programa de fuerza activo.', {
      activeProgram: await this.query.summaryOf(active),
    });
  }

  /** Cierra el programa anterior sin pagar ni penalizar su semana en curso (caso límite 3). */
  async stopForReplacement(active: TrainingProgramModel, transaction: import('sequelize').Transaction) {
    await this.programs.closeProgram(active, 'STOPPED', 'REPLACED', transaction);
    if (active.assignmentId) {
      await this.routines.setAssignmentStatus(active.assignmentId, RoutineAssignmentStatus.CANCELLED, transaction);
    }
  }
}

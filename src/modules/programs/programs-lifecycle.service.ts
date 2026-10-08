import { BadRequestException, Injectable } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { RoutineAssignmentStatus, UserRole } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { TrainingRepository } from '../training/training.repository';
import { ProgramView } from './program-view';
import { ProgramsActivationService } from './programs-activation.service';
import { ProgramsQueryService } from './programs-query.service';
import { ProgramsRepository } from './programs.repository';
import { CloseProgramInput, ActivateStrengthInput } from './programs.schemas';

type Actor = { id: string; role: UserRole; tenantId: string };

/** Detener y cerrar un programa (RF-19). El cierre pregunta; nada se repite solo (D6). */
@Injectable()
export class ProgramsLifecycleService {
  constructor(
    private readonly programs: ProgramsRepository,
    private readonly routines: TrainingRepository,
    private readonly query: ProgramsQueryService,
    private readonly activation: ProgramsActivationService,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  async stop(userId: string, programId: string): Promise<ProgramView> {
    const program = await this.query.owned(userId, programId);
    if (program.status === 'ACTIVE') await this.finish(program, 'STOPPED', 'USER_STOPPED');
    return this.query.viewById(program.id);
  }

  async close(actor: Actor, programId: string, input: CloseProgramInput) {
    const program = await this.query.owned(actor.id, programId);
    if (program.status !== 'ACTIVE') throw new BadRequestException('Este programa ya está cerrado.');
    const ended = this.dates.today() > program.plannedEndDate;

    if (input.action === 'REPEAT') {
      const next = await this.repeat(actor, program);
      return { cerrado: await this.query.viewById(program.id), siguiente: next };
    }
    if (input.action === 'STOP' || !ended) {
      await this.finish(program, 'STOPPED', 'USER_STOPPED');
    } else {
      await this.finish(program, 'FINISHED', 'COMPLETED');
    }
    return { cerrado: await this.query.viewById(program.id), siguiente: null };
  }

  /** Repite con el peso sugerido actual como nueva base (D6). */
  private async repeat(actor: Actor, program: NonNullable<Awaited<ReturnType<ProgramsRepository['findById']>>>) {
    if (!program.routineId) throw new BadRequestException('No hay rutina que repetir.');
    const lifts = await this.programs.listLifts(program.id);
    const mode = program.mode as ActivateStrengthInput['mode'];
    if (mode === 'STRENGTH_GOALS' && lifts.every((l) => l.reachedAt)) {
      throw new BadRequestException('Alcanzaste todas tus metas: elige otra rutina o define metas nuevas.');
    }
    const input: ActivateStrengthInput = {
      routineId: program.routineId,
      startDate: undefined,
      durationWeeks: Number((program.config as { durationWeeks?: number }).durationWeeks) || undefined,
      mode,
      replace: true,
      weekdays: (program.config as { weekdays?: number[] }).weekdays,
      liftTargets:
        mode === 'NONE'
          ? undefined
          : lifts.map((l) => ({
              exerciseId: l.exerciseId,
              workingWeightKg: Number(l.suggestedKg),
              repsMin: l.repsMin,
              repsMax: l.repsMax,
              rirTarget: l.rirTarget,
              goalKg: l.goalKg == null ? undefined : Number(l.goalKg),
              goalDate: undefined,
              current: l.currentE1rmKg == null ? undefined : { weightKg: Number(l.currentE1rmKg), reps: 1 },
            })),
    };
    // La meta sigue vigente: si ya no tiene fecha, la repetición arranca sin exigirla.
    const adjusted = mode === 'STRENGTH_GOALS' ? await this.withGoalDates(input, lifts, program.plannedEndDate) : input;
    const view = await this.activation.activateStrength(actor, adjusted);
    await this.sequelize.transaction((t) => this.programs.closeProgram(program, 'FINISHED', 'REPEATED', t));
    return view;
  }

  private async withGoalDates(
    input: ActivateStrengthInput,
    lifts: Awaited<ReturnType<ProgramsRepository['listLifts']>>,
    previousEnd: string,
  ): Promise<ActivateStrengthInput> {
    const horizon = this.dates.addDays(this.dates.today(), 84);
    const dateOf = (id: string) => lifts.find((l) => l.exerciseId === id)?.goalDate ?? previousEnd;
    return {
      ...input,
      liftTargets: input.liftTargets?.map((t) => ({
        ...t,
        goalDate: dateOf(t.exerciseId) < this.dates.today() ? horizon : dateOf(t.exerciseId),
      })),
    };
  }

  private async finish(
    program: NonNullable<Awaited<ReturnType<ProgramsRepository['findById']>>>,
    status: 'FINISHED' | 'STOPPED',
    reason: 'COMPLETED' | 'USER_STOPPED',
  ) {
    await this.sequelize.transaction(async (transaction) => {
      await this.programs.closeProgram(program, status, reason, transaction);
      if (program.assignmentId) {
        await this.routines.setAssignmentStatus(program.assignmentId, RoutineAssignmentStatus.CANCELLED, transaction);
      }
    });
  }
}

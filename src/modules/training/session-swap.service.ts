import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { RoutineStatus, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { SwapSessionExerciseInput } from '../workouts/free-workout.schemas';
import { FreeWorkoutService, SessionSwapOutcome } from '../workouts/free-workout.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutSessionModel } from '../workouts/workout-session.model';
import { WorkoutsRepository } from '../workouts/workouts.repository';
import { WorkoutsService } from '../workouts/workouts.service';
import { canEditRoutine } from './routine-access.policy';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineStructureService } from './routine-structure.service';
import { RoutineModel } from './routine.model';
import { TrainingRepository } from './training.repository';

type Actor = { id: string; role: UserRole; tenantId?: string };

export type SwapRoutineResult = {
  guardado: boolean;
  rutinaId: string | null;
  motivo: 'NO_SOLICITADO' | 'SIN_RUTINA' | 'NO_ESTA_EN_RUTINA' | null;
};

export type SwapResponse = {
  sesion: WorkoutSessionResponse;
  sesionEjercicioId: string;
  /** El ejercicio original ya tenía series: se conservaron y el nuevo entró detrás. */
  conservoSeries: boolean;
  rutina: SwapRoutineResult;
};

/**
 * Cambiar un ejercicio a mitad de entreno, con motivo y alcance.
 *
 * «Solo hoy» toca la sesión. «Siempre» también cambia el ejercicio en la rutina
 * de la que nació la sesión, si es de quien entrena; una rutina ajena (de un
 * coach, oficial) no se toca y se dice antes de cambiar nada.
 */
@Injectable()
export class SessionSwapService {
  constructor(
    private readonly workouts: WorkoutsService,
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly freeWorkout: FreeWorkoutService,
    private readonly routines: TrainingRepository,
    private readonly structure: RoutineStructureService,
    private readonly sequelize: Sequelize,
  ) {}

  async swap(user: Actor, sessionExerciseId: string, input: SwapSessionExerciseInput): Promise<SwapResponse> {
    const sessionExercise = await this.workoutsRepository.findSessionExerciseById(sessionExerciseId);
    if (!sessionExercise || sessionExercise.session?.userId !== user.id) {
      throw new NotFoundException('Ejercicio de sesión no encontrado.');
    }
    const session = await this.workouts.getSessionModelForUser(user.id, sessionExercise.sessionId);
    const routine = input.scope === 'RUTINA' ? await this.liveRoutineOf(session) : null;
    if (routine && !canEditRoutine(user, routine)) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        'ROUTINE_NOT_OWNED',
        'Esta rutina no es tuya: guárdala en tus rutinas para cambiarla para siempre.',
        { routineId: routine.id },
      );
    }

    const { outcome, savedToRoutine } = await this.sequelize.transaction(async (transaction) => {
      const done = await this.freeWorkout.swapInSession(
        user.id,
        sessionExerciseId,
        input,
        routine?.id ?? null,
        transaction,
      );
      const saved = routine ? await this.saveToRoutine(routine, session, done, input.exerciseId, transaction) : false;
      return { outcome: done, savedToRoutine: saved };
    });

    return {
      sesion: await this.workouts.getMySession(user.id, outcome.sessionId),
      sesionEjercicioId: outcome.sessionExerciseId,
      conservoSeries: outcome.splitAfterSets,
      rutina: routineResult(input.scope, routine, savedToRoutine),
    };
  }

  private async liveRoutineOf(session: WorkoutSessionModel): Promise<RoutineModel | null> {
    if (!session.routineId) return null;
    const routine = await this.routines.findRoutineById(session.routineId);
    return routine && routine.status === RoutineStatus.ACTIVE ? routine : null;
  }

  /**
   * Cambia el ejercicio en la fila de la rutina de la que salió. Si la sesión
   * no guardó esa fila, se empareja por día y ejercicio (como el descanso).
   */
  private async saveToRoutine(
    routine: RoutineModel,
    session: WorkoutSessionModel,
    outcome: SessionSwapOutcome,
    toExerciseId: string,
    transaction: Transaction,
  ): Promise<boolean> {
    const dayExercises = (routine.exercises ?? []).filter(
      (item) => !session.routineDayId || item.routineDayId === session.routineDayId,
    );
    const target = findRoutineRow(dayExercises, outcome);
    if (!target) return false;
    await target.update({ exerciseId: toExerciseId }, { transaction });
    await this.structure.afterStructureChange(routine, transaction);
    return true;
  }
}

function findRoutineRow(
  dayExercises: readonly RoutineExerciseModel[],
  outcome: SessionSwapOutcome,
): RoutineExerciseModel | undefined {
  const byId = outcome.routineExerciseId
    ? dayExercises.find((item) => item.id === outcome.routineExerciseId)
    : undefined;
  return (
    byId ??
    [...dayExercises]
      .sort((a, b) => a.order - b.order)
      .find((item) => item.exerciseId === outcome.fromExerciseId)
  );
}

function routineResult(
  scope: SwapSessionExerciseInput['scope'],
  routine: RoutineModel | null,
  saved: boolean,
): SwapRoutineResult {
  if (scope === 'SESION') return { guardado: false, rutinaId: null, motivo: 'NO_SOLICITADO' };
  if (!routine) return { guardado: false, rutinaId: null, motivo: 'SIN_RUTINA' };
  return { guardado: saved, rutinaId: routine.id, motivo: saved ? null : 'NO_ESTA_EN_RUTINA' };
}

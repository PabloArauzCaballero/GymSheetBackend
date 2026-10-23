import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import type { SwapReason, SwapScope } from './free-workout';
import { WorkoutExerciseSwapModel } from './workout-exercise-swap.model';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { SkipReason } from './workout-skipped-set.model';
import { SessionExerciseTargets } from './workouts.repository';

export type NewSessionExercise = {
  exerciseId: string;
  order: number;
  targets: SessionExerciseTargets;
  routineExerciseId?: string | null;
};

export type SwapLogEntry = {
  userId: string;
  sessionId: string;
  sessionExerciseId: string;
  fromExerciseId: string;
  toExerciseId: string;
  reason: SwapReason;
  note: string | null;
  scope: SwapScope;
  routineId: string | null;
};

/**
 * Escrituras de la rutina libre y del cambio de ejercicio. Todas reciben la
 * transacción de quien llama: crear la sesión con sus ejercicios, o cambiar un
 * ejercicio y su rutina, son una sola cosa o ninguna.
 */
@Injectable()
export class SessionEditsRepository {
  constructor(
    @InjectModel(WorkoutSessionModel)
    private readonly sessionModel: typeof WorkoutSessionModel,
    @InjectModel(WorkoutSessionExerciseModel)
    private readonly sessionExerciseModel: typeof WorkoutSessionExerciseModel,
    @InjectModel(WorkoutExerciseSwapModel)
    private readonly swapModel: typeof WorkoutExerciseSwapModel,
  ) {}

  createSession(userId: string, observation: string | null, transaction: Transaction): Promise<WorkoutSessionModel> {
    return this.sessionModel.create({ userId, observation }, { transaction });
  }

  async addExercises(
    sessionId: string,
    items: readonly NewSessionExercise[],
    transaction: Transaction,
  ): Promise<void> {
    await this.sessionExerciseModel.bulkCreate(
      items.map((item) => ({
        sessionId,
        exerciseId: item.exerciseId,
        order: item.order,
        isEmphasis: false,
        note: null,
        routineExerciseId: item.routineExerciseId ?? null,
        ...item.targets,
      })),
      { transaction },
    );
  }

  /** Cambia el ejercicio sin tocar su sitio ni su objetivo (aún no tenía series). */
  async replaceExercise(
    sessionExercise: WorkoutSessionExerciseModel,
    exerciseId: string,
    transaction: Transaction,
  ): Promise<void> {
    await sessionExercise.update(
      { exerciseId, omittedReason: null, omittedNote: null, omittedAt: null },
      { transaction },
    );
  }

  async omit(
    sessionExercise: WorkoutSessionExerciseModel,
    reason: SkipReason,
    note: string | null,
    transaction: Transaction,
  ): Promise<void> {
    await sessionExercise.update(
      { omittedReason: reason, omittedNote: note, omittedAt: sessionExercise.omittedAt ?? new Date() },
      { transaction },
    );
  }

  /**
   * Abre un hueco detrás de `order`: los ejercicios siguientes bajan un puesto.
   * De abajo arriba, para no chocar con la unicidad `(sesion_id, orden)`.
   */
  async openSlotAfter(sessionId: string, order: number, transaction: Transaction): Promise<void> {
    const after = await this.sessionExerciseModel.findAll({
      where: { sessionId, order: { [Op.gt]: order } },
      order: [['order', 'DESC']],
      transaction,
    });
    await after.reduce(
      (previous, item) => previous.then(() => item.update({ order: item.order + 1 }, { transaction })).then(() => undefined),
      Promise.resolve(),
    );
  }

  async createOne(sessionId: string, item: NewSessionExercise, transaction: Transaction): Promise<WorkoutSessionExerciseModel> {
    return this.sessionExerciseModel.create(
      {
        sessionId,
        exerciseId: item.exerciseId,
        order: item.order,
        isEmphasis: false,
        note: null,
        routineExerciseId: item.routineExerciseId ?? null,
        ...item.targets,
      },
      { transaction },
    );
  }

  async logSwap(entry: SwapLogEntry, transaction: Transaction): Promise<void> {
    await this.swapModel.create({ ...entry }, { transaction });
  }
}

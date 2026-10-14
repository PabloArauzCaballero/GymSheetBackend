import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExerciseModel } from '../exercises/exercise.model';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { SkipReason, WorkoutSkippedSetModel } from './workout-skipped-set.model';
import {
  AddSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutSetInput,
  UpdateSessionExerciseInput,
  UpdateWorkoutSetInput,
  WorkoutSessionListInput,
} from './workouts.schemas';

export type WorkoutSessionPage = {
  rows: WorkoutSessionModel[];
  count: number;
};

const sessionExercisesAssociation = {
  model: WorkoutSessionExerciseModel,
  as: 'sessionExercises',
};

const workoutSetsAssociation = {
  model: WorkoutSetModel,
  as: 'sets',
};

const skippedSetsAssociation = {
  model: WorkoutSkippedSetModel,
  as: 'skippedSets',
  required: false,
};

/** Descanso e intervalo de un ejercicio de la sesión (D2). */
export type SessionExerciseRestChange = {
  restSeconds?: number;
  restBetweenSeconds?: number;
  durationSeconds?: number;
};

/** Copia del objetivo de la rutina que guía la sesión (C3.a). */
export type SessionExerciseTargets = {
  targetSets: number | null;
  repsMin: number | null;
  repsMax: number | null;
  targetWeightKg: string | null;
  targetRir: number | null;
  restSeconds: number | null;
  restBetweenSeconds: number | null;
  durationSeconds: number | null;
  group: number | null;
  groupType: 'SUPERSERIE' | 'CIRCUITO' | null;
};

@Injectable()
export class WorkoutsRepository {
  constructor(
    @InjectModel(WorkoutSessionModel)
    private readonly sessionModel: typeof WorkoutSessionModel,
    @InjectModel(WorkoutSessionExerciseModel)
    private readonly sessionExerciseModel: typeof WorkoutSessionExerciseModel,
    @InjectModel(WorkoutSetModel)
    private readonly setModel: typeof WorkoutSetModel,
    @InjectModel(WorkoutSkippedSetModel)
    private readonly skippedSetModel: typeof WorkoutSkippedSetModel,
  ) {}

  createSession(
    userId: string,
    input: CreateWorkoutSessionInput,
  ): Promise<WorkoutSessionModel> {
    return this.sessionModel.create({
      userId,
      observation: input.observation,
    });
  }

  findSessionByIdForUser(
    sessionId: string,
    userId: string,
  ): Promise<WorkoutSessionModel | null> {
    return this.sessionModel.findOne({
      where: { id: sessionId, userId },
      include: [
        {
          ...sessionExercisesAssociation,
          include: [
            { model: ExerciseModel, as: 'exercise' },
            workoutSetsAssociation,
            skippedSetsAssociation,
          ],
        },
      ],
      order: [
        [sessionExercisesAssociation, 'order', 'ASC'],
        [sessionExercisesAssociation, workoutSetsAssociation, 'setNumber', 'ASC'],
      ],
    });
  }

  listSessionsForUser(
    userId: string,
    pagination: WorkoutSessionListInput,
  ): Promise<WorkoutSessionPage> {
    return this.sessionModel.findAndCountAll({
      where: { userId },
      distinct: true,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      include: [
        {
          ...sessionExercisesAssociation,
          include: [
            { model: ExerciseModel, as: 'exercise' },
            workoutSetsAssociation,
            skippedSetsAssociation,
          ],
        },
      ],
      order: [['startedAt', 'DESC']],
    });
  }

  findOpenSessionForUser(userId: string): Promise<WorkoutSessionModel | null> {
    return this.sessionModel.findOne({
      where: { userId, status: WorkoutSessionStatus.IN_PROGRESS },
      order: [['startedAt', 'DESC']],
    });
  }

  /**
   * Cierra la sesión solo si sigue en progreso, en una única sentencia. Devuelve
   * `false` si otra petición ya la cerró: es lo que distingue al ganador de un
   * doble toque del que solo debe repetir la respuesta.
   */
  async claimSessionClose(
    session: WorkoutSessionModel,
    status: WorkoutSessionStatus,
    extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
  ): Promise<boolean> {
    const [affected] = await this.sessionModel.update(
      { status, finishedAt: new Date(), ...extra },
      { where: { id: session.id, status: WorkoutSessionStatus.IN_PROGRESS } },
    );
    if (affected > 0) await session.reload();
    return affected > 0;
  }

  async saveCloseResult(sessionId: string, result: Record<string, unknown>): Promise<void> {
    await this.sessionModel.update({ closeResult: result }, { where: { id: sessionId } });
  }

  async findCloseResult(
    sessionId: string,
  ): Promise<{ status: WorkoutSessionStatus; closeResult: Record<string, unknown> | null } | null> {
    const row = await this.sessionModel.findByPk(sessionId, {
      attributes: ['id', 'status', 'closeResult'],
    });
    return row ? { status: row.status, closeResult: row.closeResult ?? null } : null;
  }

  async changeSessionStatus(
    session: WorkoutSessionModel,
    status: WorkoutSessionStatus,
    extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
  ): Promise<WorkoutSessionModel> {
    await session.update({
      status,
      finishedAt: new Date(),
      ...extra,
    });
    return session;
  }

  addExerciseToSession(
    sessionId: string,
    input: AddSessionExerciseInput,
    targets?: SessionExerciseTargets,
  ): Promise<WorkoutSessionExerciseModel> {
    return this.sessionExerciseModel.create({
      sessionId,
      exerciseId: input.exerciseId,
      order: input.order,
      isEmphasis: input.isEmphasis,
      note: input.note,
      ...(targets ?? {}),
    });
  }

  findSessionExerciseById(
    sessionExerciseId: string,
  ): Promise<WorkoutSessionExerciseModel | null> {
    return this.sessionExerciseModel.findByPk(sessionExerciseId, {
      include: [
        { model: WorkoutSessionModel, as: 'session' },
        workoutSetsAssociation,
        skippedSetsAssociation,
      ],
    });
  }

  /** El mismo ejercicio con su ficha, para devolverlo entero tras omitirlo. */
  findSessionExerciseWithExercise(
    sessionExerciseId: string,
  ): Promise<WorkoutSessionExerciseModel | null> {
    return this.sessionExerciseModel.findByPk(sessionExerciseId, {
      include: [
        { model: ExerciseModel, as: 'exercise' },
        workoutSetsAssociation,
        skippedSetsAssociation,
      ],
      order: [[workoutSetsAssociation, 'setNumber', 'ASC']],
    });
  }

  async setOmitted(
    sessionExercise: WorkoutSessionExerciseModel,
    omitted: { reason: SkipReason; note: string | null } | null,
  ): Promise<void> {
    await sessionExercise.update(
      omitted
        ? {
            omittedReason: omitted.reason,
            omittedNote: omitted.note,
            // Repetir «omitir» cambia el motivo, no la hora en que se decidió.
            omittedAt: sessionExercise.omittedAt ?? new Date(),
          }
        : { omittedReason: null, omittedNote: null, omittedAt: null },
    );
  }

  /**
   * Guarda (o corrige) la serie saltada de ese número. La unicidad
   * `(sesion_ejercicio_id, numero_serie)` hace de candado: dos toques seguidos
   * acaban en la misma fila.
   */
  async upsertSkippedSet(
    sessionExerciseId: string,
    input: { setNumber: number; reason: SkipReason; note: string | null },
    transaction?: Transaction,
  ): Promise<WorkoutSkippedSetModel> {
    const existing = await this.skippedSetModel.findOne({
      where: { sessionExerciseId, setNumber: input.setNumber },
      transaction,
    });
    if (existing) {
      await existing.update({ reason: input.reason, note: input.note }, { transaction });
      return existing;
    }
    return this.skippedSetModel.create(
      { sessionExerciseId, setNumber: input.setNumber, reason: input.reason, note: input.note },
      { transaction },
    );
  }

  findSkippedSetById(skippedSetId: string): Promise<WorkoutSkippedSetModel | null> {
    return this.skippedSetModel.findByPk(skippedSetId, {
      include: [
        {
          model: WorkoutSessionExerciseModel,
          as: 'sessionExercise',
          include: [{ model: WorkoutSessionModel, as: 'session' }],
        },
      ],
    });
  }

  deleteSkippedSet(skippedSetId: string): Promise<number> {
    return this.skippedSetModel.destroy({ where: { id: skippedSetId } });
  }

  /** Al registrar la serie de verdad, la saltada de ese número deja de serlo. */
  deleteSkippedSetByNumber(
    sessionExerciseId: string,
    setNumber: number,
    transaction?: Transaction,
  ): Promise<number> {
    return this.skippedSetModel.destroy({ where: { sessionExerciseId, setNumber }, transaction });
  }

  async updateSessionExerciseRest(
    sessionExercise: WorkoutSessionExerciseModel,
    change: SessionExerciseRestChange,
    transaction?: Transaction,
  ): Promise<void> {
    await sessionExercise.update(change, { transaction });
  }

  async updateSessionExercise(
    sessionExercise: WorkoutSessionExerciseModel,
    input: UpdateSessionExerciseInput,
  ): Promise<WorkoutSessionExerciseModel> {
    await sessionExercise.update(input);
    return sessionExercise;
  }

  deleteSessionExercise(sessionExerciseId: string): Promise<number> {
    return this.sessionExerciseModel.destroy({ where: { id: sessionExerciseId } });
  }

  findSetBySessionExerciseAndNumber(
    sessionExerciseId: string,
    setNumber: number,
    transaction?: Transaction,
  ): Promise<WorkoutSetModel | null> {
    return this.setModel.findOne({
      where: { sessionExerciseId, setNumber },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createSet(
    sessionExerciseId: string,
    input: CreateWorkoutSetInput,
    transaction?: Transaction,
  ): Promise<WorkoutSetModel> {
    return this.setModel.create(
      input.type === 'FUERZA'
        ? {
            sessionExerciseId,
            type: 'FUERZA',
            setNumber: input.setNumber,
            repetitions: input.repetitions,
            weightKg: input.weightKg == null ? null : input.weightKg.toString(),
            rir: input.rir,
            durationSeconds: input.durationSeconds,
            previousRestSeconds: input.previousRestSeconds,
          }
        : {
            sessionExerciseId,
            type: 'CARDIO',
            setNumber: input.setNumber,
            durationSeconds: input.durationSeconds,
            distanceM: input.distanceM,
            avgHeartRate: input.avgHeartRate,
            rpe: input.rpe,
            previousRestSeconds: input.previousRestSeconds,
          },
      { transaction },
    );
  }

  findSetById(setId: string): Promise<WorkoutSetModel | null> {
    return this.setModel.findByPk(setId, {
      include: [
        {
          model: WorkoutSessionExerciseModel,
          as: 'sessionExercise',
          include: [{ model: WorkoutSessionModel, as: 'session' }],
        },
      ],
    });
  }

  async updateSet(
    set: WorkoutSetModel,
    input: UpdateWorkoutSetInput,
  ): Promise<WorkoutSetModel> {
    const changes = {
      ...input,
      ...(input.weightKg !== undefined
        ? { weightKg: input.weightKg.toString() }
        : {}),
    };
    await set.update(changes);
    return set;
  }

  deleteSet(setId: string): Promise<number> {
    return this.setModel.destroy({ where: { id: setId } });
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExerciseModel } from '../exercises/exercise.model';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
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

@Injectable()
export class WorkoutsRepository {
  constructor(
    @InjectModel(WorkoutSessionModel)
    private readonly sessionModel: typeof WorkoutSessionModel,
    @InjectModel(WorkoutSessionExerciseModel)
    private readonly sessionExerciseModel: typeof WorkoutSessionExerciseModel,
    @InjectModel(WorkoutSetModel)
    private readonly setModel: typeof WorkoutSetModel,
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
          model: WorkoutSessionExerciseModel,
          include: [ExerciseModel, WorkoutSetModel],
        },
      ],
      order: [
        [WorkoutSessionExerciseModel, 'order', 'ASC'],
        [WorkoutSessionExerciseModel, WorkoutSetModel, 'setNumber', 'ASC'],
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
          model: WorkoutSessionExerciseModel,
          include: [ExerciseModel, WorkoutSetModel],
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

  async changeSessionStatus(
    session: WorkoutSessionModel,
    status: WorkoutSessionStatus,
  ): Promise<WorkoutSessionModel> {
    await session.update({
      status,
      finishedAt: new Date(),
    });
    return session;
  }

  addExerciseToSession(
    sessionId: string,
    input: AddSessionExerciseInput,
  ): Promise<WorkoutSessionExerciseModel> {
    return this.sessionExerciseModel.create({
      sessionId,
      exerciseId: input.exerciseId,
      order: input.order,
      isEmphasis: input.isEmphasis,
      note: input.note,
    });
  }

  findSessionExerciseById(
    sessionExerciseId: string,
  ): Promise<WorkoutSessionExerciseModel | null> {
    return this.sessionExerciseModel.findByPk(sessionExerciseId, {
      include: [WorkoutSessionModel, WorkoutSetModel],
    });
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
      {
        sessionExerciseId,
        ...input,
        weightKg: input.weightKg.toString(),
      },
      { transaction },
    );
  }

  findSetById(setId: string): Promise<WorkoutSetModel | null> {
    return this.setModel.findByPk(setId, {
      include: [
        {
          model: WorkoutSessionExerciseModel,
          include: [WorkoutSessionModel],
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

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExerciseModel } from '../exercises/exercise.model';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { AddSessionExerciseInput, CreateWorkoutSessionInput, CreateWorkoutSetInput, UpdateSessionExerciseInput, UpdateWorkoutSetInput } from './workouts.schemas';

@Injectable()
export class WorkoutsRepository {
  constructor(
    @InjectModel(WorkoutSessionModel) private readonly sessionModel: typeof WorkoutSessionModel,
    @InjectModel(WorkoutSessionExerciseModel) private readonly sessionExerciseModel: typeof WorkoutSessionExerciseModel,
    @InjectModel(WorkoutSetModel) private readonly setModel: typeof WorkoutSetModel,
  ) {}

  createSession(userId: string, input: CreateWorkoutSessionInput): Promise<WorkoutSessionModel> {
    return this.sessionModel.create({ usuarioId: userId, observacion: input.observacion ?? null });
  }

  findSessionByIdForUser(sessionId: string, userId: string): Promise<WorkoutSessionModel | null> {
    return this.sessionModel.findOne({
      where: { id: sessionId, usuarioId: userId },
      include: [{ model: WorkoutSessionExerciseModel, include: [ExerciseModel, WorkoutSetModel] }],
    });
  }

  listSessionsForUser(userId: string): Promise<WorkoutSessionModel[]> {
    return this.sessionModel.findAll({
      where: { usuarioId: userId },
      include: [{ model: WorkoutSessionExerciseModel, include: [ExerciseModel, WorkoutSetModel] }],
      order: [['fechaInicio', 'DESC']],
    });
  }

  async changeSessionStatus(session: WorkoutSessionModel, status: WorkoutSessionStatus): Promise<WorkoutSessionModel> {
    await session.update({ estado: status, fechaFin: new Date() });
    return session;
  }

  addExerciseToSession(sessionId: string, input: AddSessionExerciseInput): Promise<WorkoutSessionExerciseModel> {
    return this.sessionExerciseModel.create({
      sesionId: sessionId,
      ejercicioId: input.ejercicioId,
      orden: input.orden,
      esEnfasis: input.esEnfasis,
      nota: input.nota ?? null,
    });
  }

  findSessionExerciseById(id: string): Promise<WorkoutSessionExerciseModel | null> {
    return this.sessionExerciseModel.findByPk(id, { include: [WorkoutSessionModel, WorkoutSetModel] });
  }

  async updateSessionExercise(sessionExercise: WorkoutSessionExerciseModel, input: UpdateSessionExerciseInput): Promise<WorkoutSessionExerciseModel> {
    await sessionExercise.update(input);
    return sessionExercise;
  }

  deleteSessionExercise(id: string): Promise<number> {
    return this.sessionExerciseModel.destroy({ where: { id } });
  }

  findSetBySessionExerciseAndNumber(sessionExerciseId: string, numeroSerie: number): Promise<WorkoutSetModel | null> {
    return this.setModel.findOne({ where: { sesionEjercicioId: sessionExerciseId, numeroSerie } });
  }

  createSet(sessionExerciseId: string, input: CreateWorkoutSetInput, transaction?: Transaction): Promise<WorkoutSetModel> {
    return this.setModel.create({ sesionEjercicioId: sessionExerciseId, ...input }, { transaction });
  }

  findSetById(id: string): Promise<WorkoutSetModel | null> {
    return this.setModel.findByPk(id, { include: [{ model: WorkoutSessionExerciseModel, include: [WorkoutSessionModel] }] });
  }

  async updateSet(set: WorkoutSetModel, input: UpdateWorkoutSetInput): Promise<WorkoutSetModel> {
    await set.update(input);
    return set;
  }

  deleteSet(id: string): Promise<number> {
    return this.setModel.destroy({ where: { id } });
  }
}

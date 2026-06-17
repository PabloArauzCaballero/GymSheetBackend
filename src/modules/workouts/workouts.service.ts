import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSetModel } from './workout-set.model';
import { WorkoutsRepository } from './workouts.repository';
import { AddSessionExerciseInput, CreateWorkoutSessionInput, CreateWorkoutSetInput, UpdateSessionExerciseInput, UpdateWorkoutSetInput } from './workouts.schemas';

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly exercisesService: ExercisesService,
    private readonly sequelize: Sequelize,
  ) {}

  startSession(userId: string, input: CreateWorkoutSessionInput) {
    return this.workoutsRepository.createSession(userId, input);
  }

  listMySessions(userId: string) {
    return this.workoutsRepository.listSessionsForUser(userId);
  }

  async getMySession(userId: string, sessionId: string) {
    const session = await this.workoutsRepository.findSessionByIdForUser(sessionId, userId);

    if (!session) {
      throw new NotFoundException('Sesión de entrenamiento no encontrada.');
    }

    return session;
  }

  async finishSession(userId: string, sessionId: string) {
    const session = await this.getMySession(userId, sessionId);
    this.assertSessionInProgress(session.estado);
    return this.workoutsRepository.changeSessionStatus(session, WorkoutSessionStatus.FINALIZADA);
  }

  async cancelSession(userId: string, sessionId: string) {
    const session = await this.getMySession(userId, sessionId);
    this.assertSessionInProgress(session.estado);
    return this.workoutsRepository.changeSessionStatus(session, WorkoutSessionStatus.CANCELADA);
  }

  async addExerciseToSession(userId: string, sessionId: string, input: AddSessionExerciseInput) {
    const session = await this.getMySession(userId, sessionId);
    this.assertSessionInProgress(session.estado);
    await this.exercisesService.getVisibleExerciseOrFail(input.ejercicioId, userId);
    return this.workoutsRepository.addExerciseToSession(sessionId, input);
  }

  async updateSessionExercise(userId: string, sessionExerciseId: string, input: UpdateSessionExerciseInput) {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(userId, sessionExerciseId);
    this.assertSessionInProgress(sessionExercise.sesion?.estado);
    return this.workoutsRepository.updateSessionExercise(sessionExercise, input);
  }

  async deleteSessionExercise(userId: string, sessionExerciseId: string) {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(userId, sessionExerciseId);
    this.assertSessionInProgress(sessionExercise.sesion?.estado);
    await this.workoutsRepository.deleteSessionExercise(sessionExerciseId);
    return { deleted: true };
  }

  async addSet(userId: string, sessionExerciseId: string, input: CreateWorkoutSetInput) {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(userId, sessionExerciseId);
    this.assertSessionInProgress(sessionExercise.sesion?.estado);

    return this.sequelize.transaction(async (transaction) => {
      const duplicatedSet = await this.workoutsRepository.findSetBySessionExerciseAndNumber(sessionExerciseId, input.numeroSerie);

      if (duplicatedSet) {
        throw new ConflictException('Ya existe una serie con ese número para este ejercicio de la sesión.');
      }

      return this.workoutsRepository.createSet(sessionExerciseId, input, transaction);
    });
  }

  async updateSet(userId: string, setId: string, input: UpdateWorkoutSetInput) {
    const set = await this.getSetOwnedByUserOrFail(userId, setId);
    this.assertSessionInProgress(set.sesionEjercicio?.sesion?.estado);
    return this.workoutsRepository.updateSet(set, input);
  }

  async deleteSet(userId: string, setId: string) {
    const set = await this.getSetOwnedByUserOrFail(userId, setId);
    this.assertSessionInProgress(set.sesionEjercicio?.sesion?.estado);
    await this.workoutsRepository.deleteSet(set.id);
    return { deleted: true };
  }

  private async getSessionExerciseOwnedByUserOrFail(userId: string, sessionExerciseId: string): Promise<WorkoutSessionExerciseModel> {
    const sessionExercise = await this.workoutsRepository.findSessionExerciseById(sessionExerciseId);

    if (!sessionExercise || sessionExercise.sesion?.usuarioId !== userId) {
      throw new NotFoundException('Ejercicio de sesión no encontrado.');
    }

    return sessionExercise;
  }

  private async getSetOwnedByUserOrFail(userId: string, setId: string): Promise<WorkoutSetModel> {
    const set = await this.workoutsRepository.findSetById(setId);

    if (!set || set.sesionEjercicio?.sesion?.usuarioId !== userId) {
      throw new NotFoundException('Serie no encontrada.');
    }

    return set;
  }

  private assertSessionInProgress(status: WorkoutSessionStatus | undefined): void {
    if (status !== WorkoutSessionStatus.EN_PROGRESO) {
      throw new ForbiddenException('Solo se puede modificar una sesión en progreso.');
    }
  }
}

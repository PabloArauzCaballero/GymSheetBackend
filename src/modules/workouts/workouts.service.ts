import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import {
  mapSessionExerciseToResponse,
  mapWorkoutSessionToResponse,
  mapWorkoutSetToResponse,
  WorkoutSessionExerciseResponse,
  WorkoutSessionPageResponse,
  WorkoutSessionResponse,
  WorkoutSetResponse,
} from './workout.mapper';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { WorkoutsRepository } from './workouts.repository';
import {
  AddSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutSetInput,
  UpdateSessionExerciseInput,
  UpdateWorkoutSetInput,
  WorkoutSessionListInput,
} from './workouts.schemas';

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly exercisesService: ExercisesService,
    private readonly sequelize: Sequelize,
  ) {}

  async startSession(
    userId: string,
    input: CreateWorkoutSessionInput,
  ): Promise<WorkoutSessionResponse> {
    const openSession = await this.workoutsRepository.findOpenSessionForUser(userId);

    if (openSession) {
      throw new ConflictException(
        'Ya existe una sesión de entrenamiento en progreso para este usuario.',
      );
    }

    const session = await this.workoutsRepository.createSession(userId, input);
    return mapWorkoutSessionToResponse(session);
  }

  async listMySessions(
    userId: string,
    pagination: WorkoutSessionListInput,
  ): Promise<WorkoutSessionPageResponse> {
    const result = await this.workoutsRepository.listSessionsForUser(userId, pagination);

    return {
      items: result.rows.map(mapWorkoutSessionToResponse),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / pagination.pageSize),
    };
  }

  async getMySession(userId: string, sessionId: string): Promise<WorkoutSessionResponse> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    return mapWorkoutSessionToResponse(session);
  }

  async finishSession(
    userId: string,
    sessionId: string,
  ): Promise<WorkoutSessionResponse> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    this.assertSessionInProgress(session.status);
    const completedSession = await this.workoutsRepository.changeSessionStatus(
      session,
      WorkoutSessionStatus.COMPLETED,
    );
    return mapWorkoutSessionToResponse(completedSession);
  }

  async cancelSession(
    userId: string,
    sessionId: string,
  ): Promise<WorkoutSessionResponse> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    this.assertSessionInProgress(session.status);
    const cancelledSession = await this.workoutsRepository.changeSessionStatus(
      session,
      WorkoutSessionStatus.CANCELLED,
    );
    return mapWorkoutSessionToResponse(cancelledSession);
  }

  async addExerciseToSession(
    userId: string,
    sessionId: string,
    input: AddSessionExerciseInput,
  ): Promise<WorkoutSessionExerciseResponse> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    this.assertSessionInProgress(session.status);
    await this.exercisesService.getVisibleExerciseOrFail(input.exerciseId, userId);

    try {
      const sessionExercise = await this.workoutsRepository.addExerciseToSession(
        sessionId,
        input,
      );
      return mapSessionExerciseToResponse(sessionExercise);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          'El ejercicio u orden ya existe en esta sesión de entrenamiento.',
        );
      }
      throw error;
    }
  }

  async updateSessionExercise(
    userId: string,
    sessionExerciseId: string,
    input: UpdateSessionExerciseInput,
  ): Promise<WorkoutSessionExerciseResponse> {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(
      userId,
      sessionExerciseId,
    );
    this.assertSessionInProgress(sessionExercise.session?.status);

    try {
      const updatedExercise = await this.workoutsRepository.updateSessionExercise(
        sessionExercise,
        input,
      );
      return mapSessionExerciseToResponse(updatedExercise);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('El orden ya está ocupado en esta sesión.');
      }
      throw error;
    }
  }

  async deleteSessionExercise(
    userId: string,
    sessionExerciseId: string,
  ): Promise<{ deleted: true }> {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(
      userId,
      sessionExerciseId,
    );
    this.assertSessionInProgress(sessionExercise.session?.status);
    await this.workoutsRepository.deleteSessionExercise(sessionExerciseId);
    return { deleted: true };
  }

  async addSet(
    userId: string,
    sessionExerciseId: string,
    input: CreateWorkoutSetInput,
  ): Promise<WorkoutSetResponse> {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(
      userId,
      sessionExerciseId,
    );
    this.assertSessionInProgress(sessionExercise.session?.status);

    try {
      const set = await this.sequelize.transaction(async (transaction) => {
        const duplicatedSet =
          await this.workoutsRepository.findSetBySessionExerciseAndNumber(
            sessionExerciseId,
            input.setNumber,
            transaction,
          );

        if (duplicatedSet) {
          throw new ConflictException(
            'Ya existe una serie con ese número para este ejercicio de la sesión.',
          );
        }

        return this.workoutsRepository.createSet(
          sessionExerciseId,
          input,
          transaction,
        );
      });
      return mapWorkoutSetToResponse(set);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          'Ya existe una serie con ese número para este ejercicio de la sesión.',
        );
      }
      throw error;
    }
  }

  async updateSet(
    userId: string,
    setId: string,
    input: UpdateWorkoutSetInput,
  ): Promise<WorkoutSetResponse> {
    const set = await this.getSetOwnedByUserOrFail(userId, setId);
    this.assertSessionInProgress(set.sessionExercise?.session?.status);
    const updatedSet = await this.workoutsRepository.updateSet(set, input);
    return mapWorkoutSetToResponse(updatedSet);
  }

  async deleteSet(userId: string, setId: string): Promise<{ deleted: true }> {
    const set = await this.getSetOwnedByUserOrFail(userId, setId);
    this.assertSessionInProgress(set.sessionExercise?.session?.status);
    await this.workoutsRepository.deleteSet(set.id);
    return { deleted: true };
  }

  private async getSessionModelOrFail(
    userId: string,
    sessionId: string,
  ): Promise<WorkoutSessionModel> {
    const session = await this.workoutsRepository.findSessionByIdForUser(
      sessionId,
      userId,
    );

    if (!session) {
      throw new NotFoundException('Sesión de entrenamiento no encontrada.');
    }

    return session;
  }

  private async getSessionExerciseOwnedByUserOrFail(
    userId: string,
    sessionExerciseId: string,
  ): Promise<WorkoutSessionExerciseModel> {
    const sessionExercise = await this.workoutsRepository.findSessionExerciseById(
      sessionExerciseId,
    );

    if (!sessionExercise || sessionExercise.session?.userId !== userId) {
      throw new NotFoundException('Ejercicio de sesión no encontrado.');
    }

    return sessionExercise;
  }

  private async getSetOwnedByUserOrFail(
    userId: string,
    setId: string,
  ): Promise<WorkoutSetModel> {
    const set = await this.workoutsRepository.findSetById(setId);

    if (!set || set.sessionExercise?.session?.userId !== userId) {
      throw new NotFoundException('Serie no encontrada.');
    }

    return set;
  }

  private assertSessionInProgress(status: WorkoutSessionStatus | undefined): void {
    if (status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new ForbiddenException('Solo se puede modificar una sesión en progreso.');
    }
  }
}

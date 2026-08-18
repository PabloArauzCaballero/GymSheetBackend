import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import {
  RoutineVisibility,
  UserRole,
  UserStatus,
} from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineModel } from './routine.model';
import {
  mapAssignmentToResponse,
  mapRoutineToResponse,
  RoutineAssignmentResponse,
  RoutinePageResponse,
  RoutineResponse,
} from './training.mapper';
import { routineWhereForScope, TrainingRepository } from './training.repository';
import {
  AssignRoutineInput,
  SelfScheduleRoutineInput,
  CreateRoutineInput,
  ImportRoutinesInput,
  ListRoutinesInput,
  RoutineExerciseInput,
  UpdateRoutineExerciseInput,
  UpdateRoutineInput,
} from './training.schemas';

const STAFF_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.COACH]);

/** Result of a bulk import: one row per submitted routine. */
export type ImportRoutineResult = {
  index: number;
  nombre: string;
  creada: boolean;
  routineId: string | null;
  error: string | null;
};

@Injectable()
export class TrainingService {
  constructor(
    private readonly repository: TrainingRepository,
    private readonly exercisesService: ExercisesService,
    private readonly workoutsService: WorkoutsService,
    private readonly sequelize: Sequelize,
  ) {}

  async createRoutine(
    user: { id: string; role: UserRole },
    input: CreateRoutineInput,
  ): Promise<RoutineResponse> {
    this.assertVisibilityAllowed(user.role, input.visibility);
    const routine = await this.repository.createRoutine(user.id, input);
    return this.getRoutineOrFail(routine.id);
  }

  async listRoutines(
    userId: string,
    input: ListRoutinesInput,
  ): Promise<RoutinePageResponse> {
    const where = routineWhereForScope(input.scope, userId);
    const result = await this.repository.listRoutines(where, input.page, input.pageSize);
    return {
      items: result.rows.map(mapRoutineToResponse),
      page: input.page,
      pageSize: input.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / input.pageSize),
    };
  }

  async getRoutineForUser(
    user: { id: string; role: UserRole },
    routineId: string,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.assertCanViewRoutine(user, routine);
    return mapRoutineToResponse(routine);
  }

  async updateRoutine(
    user: { id: string; role: UserRole },
    routineId: string,
    input: UpdateRoutineInput,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(user, routine);
    if (input.visibility) this.assertVisibilityAllowed(user.role, input.visibility);
    await this.repository.updateRoutine(routine, input);
    return this.getRoutineOrFail(routineId);
  }

  async deleteRoutine(
    user: { id: string; role: UserRole },
    routineId: string,
  ): Promise<{ deleted: true }> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(user, routine);
    await this.repository.deleteRoutine(routineId);
    return { deleted: true };
  }

  async addExercise(
    user: { id: string; role: UserRole },
    routineId: string,
    input: RoutineExerciseInput,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(user, routine);
    const exerciseId = await this.resolveExerciseId(input, user.id);
    try {
      await this.repository.addExercise(routineId, exerciseId, input);
    } catch (error: unknown) {
      throw this.translateConflict(error, 'El orden ya existe en esta rutina.');
    }
    return this.getRoutineOrFail(routineId);
  }

  async updateExercise(
    user: { id: string; role: UserRole },
    routineExerciseId: string,
    input: UpdateRoutineExerciseInput,
  ): Promise<RoutineResponse> {
    const routineExercise = await this.getRoutineExerciseOrFail(routineExerciseId);
    const routine = await this.getRoutineModelOrFail(routineExercise.routineId);
    this.assertCanEditRoutine(user, routine);
    try {
      await this.repository.updateRoutineExercise(routineExercise, input);
    } catch (error: unknown) {
      throw this.translateConflict(error, 'El orden ya existe en esta rutina.');
    }
    return this.getRoutineOrFail(routine.id);
  }

  async deleteExercise(
    user: { id: string; role: UserRole },
    routineExerciseId: string,
  ): Promise<RoutineResponse> {
    const routineExercise = await this.getRoutineExerciseOrFail(routineExerciseId);
    const routine = await this.getRoutineModelOrFail(routineExercise.routineId);
    this.assertCanEditRoutine(user, routine);
    await this.repository.deleteRoutineExercise(routineExerciseId);
    return this.getRoutineOrFail(routine.id);
  }

  /**
   * El cliente programa una rutina en su propia semana. Sólo exige que la
   * rutina le sea visible: no puede convertir en suya una rutina privada de
   * otro, pero sí planificar cualquiera del catálogo compartido.
   */
  async selfScheduleRoutine(
    userId: string,
    routineId: string,
    input: SelfScheduleRoutineInput,
  ): Promise<RoutineAssignmentResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    if (
      routine.visibility === RoutineVisibility.PRIVATE &&
      routine.createdByUserId !== userId
    ) {
      throw new NotFoundException('Rutina no encontrada.');
    }

    const assignment = await this.repository.upsertSelfAssignment(
      routineId,
      userId,
      input,
    );
    const hydrated = await this.repository.findAssignmentById(assignment.id);
    return mapAssignmentToResponse(hydrated ?? assignment);
  }

  async assignRoutine(
    coach: { id: string; role: UserRole },
    routineId: string,
    input: AssignRoutineInput,
  ): Promise<RoutineAssignmentResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(coach, routine);

    const client = await this.repository.findClientById(input.clientUserId);
    if (!client || client.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('Cliente no encontrado o inactivo.');
    }
    if (client.id === coach.id) {
      throw new BadRequestException('No puedes asignarte una rutina a ti mismo como coach.');
    }

    // Make the routine visible to the assignee.
    if (routine.visibility === RoutineVisibility.PRIVATE) {
      await this.repository.updateRoutine(routine, { visibility: RoutineVisibility.SHARED });
    }

    try {
      const assignment = await this.repository.createAssignment(routineId, coach.id, input);
      const hydrated = await this.repository.findAssignmentById(assignment.id);
      return mapAssignmentToResponse(hydrated ?? assignment);
    } catch (error: unknown) {
      throw this.translateConflict(
        error,
        'Este cliente ya tiene una asignación activa de esta rutina.',
      );
    }
  }

  async listMyAssignments(clientUserId: string): Promise<RoutineAssignmentResponse[]> {
    const assignments = await this.repository.listAssignmentsForClient(clientUserId);
    return assignments.map(mapAssignmentToResponse);
  }

  async listCoachAssignments(coachUserId: string): Promise<RoutineAssignmentResponse[]> {
    const assignments = await this.repository.listAssignmentsByCoach(coachUserId);
    return assignments.map(mapAssignmentToResponse);
  }

  async importRoutines(
    user: { id: string; role: UserRole },
    input: ImportRoutinesInput,
  ): Promise<{ resultados: ImportRoutineResult[]; creadas: number }> {
    const results: ImportRoutineResult[] = [];

    for (const [index, routineInput] of input.routines.entries()) {
      this.assertVisibilityAllowed(user.role, routineInput.visibility);
      try {
        const routineId = await this.sequelize.transaction(async (transaction) => {
          const routine = await this.repository.createRoutine(
            user.id,
            {
              name: routineInput.name,
              description: routineInput.description,
              visibility: routineInput.visibility,
              goal: routineInput.goal,
            },
            transaction,
          );
          for (const exercise of routineInput.exercises) {
            const exerciseId = await this.resolveExerciseId(exercise, user.id);
            await this.repository.addExercise(routine.id, exerciseId, exercise, transaction);
          }
          return routine.id;
        });
        results.push({
          index,
          nombre: routineInput.name,
          creada: true,
          routineId,
          error: null,
        });
      } catch (error: unknown) {
        results.push({
          index,
          nombre: routineInput.name,
          creada: false,
          routineId: null,
          error: error instanceof Error ? error.message : 'Error desconocido.',
        });
      }
    }

    return { resultados: results, creadas: results.filter((r) => r.creada).length };
  }

  /** Starts a live workout session pre-loaded with the routine's ordered exercises. */
  async startSessionFromRoutine(
    user: { id: string; role: UserRole },
    routineId: string,
  ): Promise<WorkoutSessionResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.assertCanViewRoutine(user, routine);

    const session = await this.workoutsService.startSession(user.id, {
      observation: `Plan: ${routine.name}`,
    });

    const exercises = [...(routine.exercises ?? [])].sort((a, b) => a.order - b.order);
    for (const exercise of exercises) {
      await this.workoutsService.addExerciseToSession(user.id, session.id, {
        exerciseId: exercise.exerciseId,
        order: exercise.order,
        isEmphasis: false,
        note: exercise.note,
      });
    }

    return this.workoutsService.getMySession(user.id, session.id);
  }

  private async resolveExerciseId(
    input: RoutineExerciseInput,
    userId: string,
  ): Promise<string> {
    if (input.exerciseId) {
      const exercise = await this.exercisesService.getVisibleExerciseOrFail(
        input.exerciseId,
        userId,
      );
      return exercise.id;
    }
    if (input.exerciseName) {
      const exercise = await this.repository.findVisibleExerciseByName(
        input.exerciseName,
        userId,
      );
      if (!exercise) {
        throw new BadRequestException(
          `Ejercicio no encontrado por nombre: "${input.exerciseName}".`,
        );
      }
      return exercise.id;
    }
    throw new BadRequestException('Cada ejercicio requiere ejercicioId o ejercicioNombre.');
  }

  private async getRoutineModelOrFail(routineId: string): Promise<RoutineModel> {
    const routine = await this.repository.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    return routine;
  }

  private async getRoutineOrFail(routineId: string): Promise<RoutineResponse> {
    return mapRoutineToResponse(await this.getRoutineModelOrFail(routineId));
  }

  private async getRoutineExerciseOrFail(id: string): Promise<RoutineExerciseModel> {
    const routineExercise = await this.repository.findRoutineExerciseById(id);
    if (!routineExercise) throw new NotFoundException('Ejercicio de rutina no encontrado.');
    return routineExercise;
  }

  private assertVisibilityAllowed(role: UserRole, visibility: RoutineVisibility): void {
    if (visibility === RoutineVisibility.TEMPLATE && !STAFF_ROLES.has(role)) {
      throw new ForbiddenException('Solo staff puede publicar rutinas como plantilla.');
    }
  }

  private assertCanEditRoutine(
    user: { id: string; role: UserRole },
    routine: RoutineModel,
  ): void {
    if (routine.createdByUserId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('No puedes modificar esta rutina.');
    }
  }

  private async assertCanViewRoutine(
    user: { id: string; role: UserRole },
    routine: RoutineModel,
  ): Promise<void> {
    if (
      routine.createdByUserId === user.id ||
      routine.visibility === RoutineVisibility.TEMPLATE ||
      user.role === UserRole.ADMIN
    ) {
      return;
    }
    const assignments = await this.repository.listAssignmentsForClient(user.id);
    if (assignments.some((assignment) => assignment.routineId === routine.id)) return;
    throw new ForbiddenException('No tienes acceso a esta rutina.');
  }

  private translateConflict(error: unknown, message: string): unknown {
    const name = error instanceof Error ? error.name : '';
    if (name === 'SequelizeUniqueConstraintError') {
      return new ConflictException(message);
    }
    return error;
  }
}

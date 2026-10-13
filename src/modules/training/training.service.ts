import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import {
  RoutineVisibility,
  RoutineStatus,
  ExerciseType,
  FitnessGoal,
  TrainingGoal,
  UserRole,
  UserStatus,
} from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { mapExerciseToResponse } from '../exercises/exercise.mapper';
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
import { selectRoutineExercises } from './routine-recommendation';
import {
  AssignRoutineInput,
  SelfScheduleRoutineInput,
  CreateRoutineInput,
  CreateCompleteRoutineInput,
  CopyRoutineInput,
  RecommendRoutineInput,
  ImportRoutinesInput,
  ListRoutinesInput,
  RoutineExerciseInput,
  UpdateRoutineExerciseInput,
  UpdateRoutineInput,
} from './training.schemas';

const STAFF_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.COACH]);
const goalFromOnboarding: Record<FitnessGoal, TrainingGoal> = {
  [FitnessGoal.GAIN_MUSCLE]: TrainingGoal.HYPERTROPHY,
  [FitnessGoal.LOSE_FAT]: TrainingGoal.FAT_LOSS,
  [FitnessGoal.IMPROVE_STRENGTH]: TrainingGoal.STRENGTH,
  [FitnessGoal.IMPROVE_ENDURANCE]: TrainingGoal.ENDURANCE,
  [FitnessGoal.MAINTAIN_FITNESS]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.GENERAL_HEALTH]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.SPORT_PERFORMANCE]: TrainingGoal.SPORT_PERFORMANCE,
};

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
    if (input.visibility === RoutineVisibility.PUBLIC) {
      throw new BadRequestException('Publica la rutina después de añadir sus ejercicios.');
    }
    const routine = await this.repository.createRoutine(user.id, input);
    return this.getRoutineOrFail(routine.id);
  }

  async createCompleteRoutine(
    user: { id: string; role: UserRole },
    input: CreateCompleteRoutineInput,
  ): Promise<RoutineResponse> {
    this.assertVisibilityAllowed(user.role, input.visibility);
    const previous = await this.repository.findRoutineByCreationKey(user.id, input.creationKey);
    if (previous) return this.getRoutineOrFail(previous.id);
    try {
      const routineId = await this.sequelize.transaction(async (transaction) => {
        const routine = await this.repository.createRoutine(user.id, input, transaction, input.creationKey);
        for (const exercise of input.exercises) {
          const exerciseId = await this.resolveExerciseId(exercise, user.id);
          if (input.visibility === RoutineVisibility.PUBLIC) {
            const visible = await this.exercisesService.getVisibleExerciseOrFail(exerciseId, user.id);
            if (visible.tipoEjercicio !== ExerciseType.GLOBAL) {
              throw new BadRequestException('Una rutina pública solo puede incluir ejercicios del catálogo general.');
            }
          }
          await this.repository.addExercise(routine.id, exerciseId, exercise, transaction);
        }
        return routine.id;
      });
      return this.getRoutineOrFail(routineId);
    } catch (error) {
      const concurrent = await this.repository.findRoutineByCreationKey(user.id, input.creationKey);
      if (concurrent) return this.getRoutineOrFail(concurrent.id);
      throw error;
    }
  }

  async listRoutines(
    user: { id: string; tenantId: string },
    input: ListRoutinesInput,
  ): Promise<RoutinePageResponse> {
    const where = routineWhereForScope(input.scope, user.id);
    if (input.goal) Object.assign(where, { goal: input.goal });
    if (input.scope === 'public') {
      const reported = await this.repository.listReportedRoutineIds(user.id);
      if (reported.length) Object.assign(where, { id: { [Op.notIn]: reported } });
    }
    const result = await this.repository.listRoutines(
      where, input.page, input.pageSize,
      input.scope === 'mine' ? undefined : user.tenantId,
    );
    return {
      items: result.rows.map(mapRoutineToResponse),
      page: input.page,
      pageSize: input.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / input.pageSize),
    };
  }

  async recommendRoutine(userId: string, input: RecommendRoutineInput) {
    const onboarding = await this.repository.getOnboarding(userId);
    const goal = input.objetivo ??
      (onboarding?.primaryGoal ? goalFromOnboarding[onboarding.primaryGoal] : TrainingGoal.GENERAL_HEALTH);
    const location = input.lugar ??
      (onboarding?.trainingLocation === 'HOME' || onboarding?.trainingLocation === 'OUTDOORS'
        ? onboarding.trainingLocation : 'GYM');
    const requiresReview = Boolean(onboarding?.physicalConsiderations?.trim()) || goal === TrainingGoal.REHABILITATION;
    if (goal === TrainingGoal.REHABILITATION) {
      return { goal, location, requiresReview, items: [], message: 'Este objetivo requiere un plan revisado por un profesional.' };
    }
    const candidates = await this.repository.listRecommendationCandidates(userId, input.publico === 'true');
    const selected = selectRoutineExercises(candidates, {
      goal,
      location,
      equipment: onboarding?.availableEquipment ?? [],
      minutes: input.minutos,
      beginner: onboarding?.experienceLevel === 'BEGINNER',
    });
    return {
      goal,
      location,
      requiresReview,
      message: requiresReview
        ? 'Revisa estas ideas con un profesional según tus consideraciones físicas antes de entrenar.'
        : 'Propuesta editable según objetivo, lugar, experiencia y material disponible.',
      items: selected.map((item) => ({
        ejercicio: mapExerciseToResponse(item.exercise),
        motivo: item.reason,
        seriesObjetivo: item.targetSets,
        repsMin: item.repsMin,
        repsMax: item.repsMax,
        descansoSeg: item.restSeconds,
      })),
    };
  }

  async getRoutineForUser(
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.assertCanViewRoutine(user, routine);
    return mapRoutineToResponse(routine);
  }

  async copyRoutine(
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
    input: CopyRoutineInput,
  ): Promise<RoutineResponse> {
    const source = await this.getRoutineModelOrFail(routineId);
    await this.assertCanViewRoutine(user, source);
    if (source.createdByUserId !== user.id &&
      source.visibility !== RoutineVisibility.PUBLIC &&
      source.visibility !== RoutineVisibility.TEMPLATE) {
      throw new ForbiddenException('Esta rutina no se puede copiar.');
    }
    if (!source.exercises?.length) {
      throw new BadRequestException('Esta rutina no tiene ejercicios para copiar.');
    }
    return this.createCompleteRoutine(user, {
      name: `${source.name} (copia)`.slice(0, 160),
      description: source.description,
      visibility: RoutineVisibility.PRIVATE,
      goal: source.goal,
      creationKey: input.creationKey,
      exercises: source.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        exerciseName: null,
        order: exercise.order,
        targetSets: exercise.targetSets,
        repsMin: exercise.repsMin,
        repsMax: exercise.repsMax,
        targetWeightKg: exercise.targetWeightKg == null ? null : Number(exercise.targetWeightKg),
        targetRir: exercise.targetRir,
        restSeconds: exercise.restSeconds,
        note: exercise.note,
      })),
    });
  }

  async updateRoutine(
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
    input: UpdateRoutineInput,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(user, routine);
    if (input.visibility) this.assertVisibilityAllowed(user.role, input.visibility);
    if (input.visibility === RoutineVisibility.PUBLIC && !routine.exercises?.length) {
      throw new BadRequestException('Añade al menos un ejercicio antes de publicar.');
    }
    if (input.visibility === RoutineVisibility.PUBLIC && routine.exercises?.some(
      (exercise) => exercise.exercise?.type !== ExerciseType.GLOBAL,
    )) {
      throw new BadRequestException('Una rutina pública solo puede incluir ejercicios del catálogo general.');
    }
    await this.repository.updateRoutine(routine, input);
    return this.getRoutineOrFail(routineId);
  }

  async replaceCompleteRoutine(
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
    input: CreateCompleteRoutineInput,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(user, routine);
    this.assertVisibilityAllowed(user.role, input.visibility);
    await this.sequelize.transaction(async (transaction) => {
      await routine.reload({ transaction, lock: transaction.LOCK.UPDATE });
      const resolved = [] as { exerciseId: string; input: RoutineExerciseInput }[];
      for (const exercise of input.exercises) {
        const exerciseId = await this.resolveExerciseId(exercise, user.id);
        if (input.visibility === RoutineVisibility.PUBLIC) {
          const visible = await this.exercisesService.getVisibleExerciseOrFail(exerciseId, user.id);
          if (visible.tipoEjercicio !== ExerciseType.GLOBAL) {
            throw new BadRequestException('Una rutina pública solo puede incluir ejercicios del catálogo general.');
          }
        }
        resolved.push({ exerciseId, input: exercise });
      }
      await this.repository.updateRoutine(routine, {
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        goal: input.goal,
      }, transaction);
      await this.repository.deleteAllRoutineExercises(routineId, transaction);
      for (const item of resolved) {
        await this.repository.addExercise(routineId, item.exerciseId, item.input, transaction);
      }
    });
    return this.getRoutineOrFail(routineId);
  }

  async deleteRoutine(
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
  ): Promise<{ deleted: true }> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(user, routine);
    await this.repository.deleteRoutine(routineId);
    return { deleted: true };
  }

  async addExercise(
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
    input: RoutineExerciseInput,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(user, routine);
    const exerciseId = await this.resolveExerciseId(input, user.id);
    if (routine.visibility === RoutineVisibility.PUBLIC) {
      const visible = await this.exercisesService.getVisibleExerciseOrFail(exerciseId, user.id);
      if (visible.tipoEjercicio !== ExerciseType.GLOBAL) {
        throw new BadRequestException('Una rutina pública solo puede incluir ejercicios del catálogo general.');
      }
    }
    try {
      await this.repository.addExercise(routineId, exerciseId, input);
    } catch (error: unknown) {
      throw this.translateConflict(error, 'El orden ya existe en esta rutina.');
    }
    return this.getRoutineOrFail(routineId);
  }

  async updateExercise(
    user: { id: string; role: UserRole; tenantId: string },
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
    user: { id: string; role: UserRole; tenantId: string },
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
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
    input: SelfScheduleRoutineInput,
  ): Promise<RoutineAssignmentResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.assertCanViewRoutine(user, routine);

    const assignment = await this.repository.upsertSelfAssignment(
      routineId,
      user.id,
      input,
    );
    const hydrated = await this.repository.findAssignmentById(assignment.id);
    return mapAssignmentToResponse(hydrated ?? assignment);
  }

  async assignRoutine(
    coach: { id: string; role: UserRole; tenantId: string },
    routineId: string,
    input: AssignRoutineInput,
  ): Promise<RoutineAssignmentResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    this.assertCanEditRoutine(coach, routine);

    const client = await this.repository.findClientById(input.clientUserId);
    if (!client || client.status !== UserStatus.ACTIVE || client.tenantId !== coach.tenantId) {
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
            if (routineInput.visibility === RoutineVisibility.PUBLIC) {
              const visible = await this.exercisesService.getVisibleExerciseOrFail(exerciseId, user.id);
              if (visible.tipoEjercicio !== ExerciseType.GLOBAL) {
                throw new BadRequestException('Una rutina pública solo puede incluir ejercicios del catálogo general.');
              }
            }
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
    user: { id: string; role: UserRole; tenantId: string },
    routineId: string,
  ): Promise<WorkoutSessionResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.assertCanViewRoutine(user, routine);

    if (!routine.exercises?.length) {
      throw new BadRequestException('Añade ejercicios antes de empezar esta rutina.');
    }
    return this.workoutsService.startPlannedSession(user.id, {
      id: routine.id,
      name: routine.name,
      exercises: routine.exercises,
    });
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
    user: { id: string; role: UserRole; tenantId: string },
    routine: RoutineModel,
  ): void {
    if (routine.createdByUserId !== user.id &&
      (user.role !== UserRole.ADMIN || routine.createdBy?.tenantId !== user.tenantId)) {
      throw new ForbiddenException('No puedes modificar esta rutina.');
    }
  }

  private async assertCanViewRoutine(
    user: { id: string; role: UserRole; tenantId: string },
    routine: RoutineModel,
  ): Promise<void> {
    if (
      routine.createdByUserId === user.id ||
      ((routine.visibility === RoutineVisibility.TEMPLATE || routine.visibility === RoutineVisibility.PUBLIC) &&
        routine.status === RoutineStatus.ACTIVE &&
        routine.hiddenAt == null &&
        routine.createdBy?.tenantId === user.tenantId) ||
      (user.role === UserRole.ADMIN && routine.createdBy?.tenantId === user.tenantId)
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

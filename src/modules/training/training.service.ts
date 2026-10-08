import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  RoutineStatus,
  RoutineVisibility,
  UserRole,
  UserStatus,
} from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';
import { canEditRoutine } from './routine-access.policy';
import { RoutineDaysRepository } from './routine-days.repository';
import { RoutineAccessService } from './routine-access.service';
import { RoutineStructureService } from './routine-structure.service';
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

type Actor = { id: string; role: UserRole; tenantId?: string };

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
    private readonly days: RoutineDaysRepository,
    private readonly access: RoutineAccessService,
    private readonly structure: RoutineStructureService,
  ) {}

  async createRoutine(
    user: Actor,
    input: CreateRoutineInput,
  ): Promise<RoutineResponse> {
    const visibility = this.normalizeVisibility(user.role, input.visibility);
    if (input.days) {
      this.structure.assertComplete(input.days);
      await this.structure.assertExercisesUsable(user.id, input.days);
    }
    const routineId = await this.sequelize.transaction(async (transaction) => {
      const routine = await this.repository.createRoutine(
        user.id,
        { ...input, visibility },
        user.tenantId ?? null,
        transaction,
      );
      await this.seedStructure(routine, input.days, transaction);
      return routine.id;
    });
    return this.getRoutineOrFail(routineId, user);
  }

  private async seedStructure(
    routine: RoutineModel,
    days: CreateRoutineInput['days'],
    transaction: Transaction,
  ): Promise<void> {
    if (days) {
      await this.days.replaceStructure(routine.id, days, transaction);
    } else {
      await this.days.firstDayId(routine.id, transaction);
    }
    await this.structure.afterStructureChange(routine, transaction);
  }

  async listRoutines(
    userId: string,
    input: ListRoutinesInput,
  ): Promise<RoutinePageResponse> {
    const where = routineWhereForScope(input.scope, userId);
    const result = await this.repository.listRoutines(where, input.page, input.pageSize);
    return {
      items: result.rows.map((routine) =>
        mapRoutineToResponse(routine, { id: userId, canEdit: routine.createdByUserId === userId }),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / input.pageSize),
    };
  }

  async getRoutineForUser(user: Actor, routineId: string): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.access.assertFullView(user, routine);
    const response = mapRoutineToResponse(routine, this.viewerOf(user, routine));
    if (routine.basedOnRoutineId && routine.basedOnVersion != null) {
      const sourceVersion = await this.repository.findVersionOf(routine.basedOnRoutineId);
      response.hayVersionNueva = sourceVersion != null && sourceVersion > routine.basedOnVersion;
    }
    return response;
  }

  async updateRoutine(
    user: Actor,
    routineId: string,
    input: UpdateRoutineInput,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.access.assertCanEdit(user, routine);
    const changes = { ...input };
    if (input.visibility) {
      changes.visibility = this.normalizeVisibility(user.role, input.visibility);
    }
    await this.repository.updateRoutine(routine, changes);
    return this.getRoutineOrFail(routineId, user);
  }

  /** Archiva (soft): las copias conservan su atribución y los programas su historial. */
  async deleteRoutine(user: Actor, routineId: string): Promise<{ deleted: true }> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.access.assertCanEdit(user, routine);
    await this.repository.updateRoutine(routine, { status: RoutineStatus.ARCHIVED });
    return { deleted: true };
  }

  async addExercise(
    user: Actor,
    routineId: string,
    input: RoutineExerciseInput,
  ): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.access.assertCanEdit(user, routine);
    const exerciseId = await this.resolveExerciseId(input, user.id);
    try {
      await this.sequelize.transaction(async (transaction) => {
        const dayId = await this.days.firstDayId(routineId, transaction);
        await this.repository.addExercise(routineId, exerciseId, input, dayId, transaction);
        await this.structure.afterStructureChange(routine, transaction);
      });
      await this.structure.announceNewVersion(routine);
    } catch (error: unknown) {
      throw this.translateConflict(error, 'El orden ya existe en esta rutina.');
    }
    return this.getRoutineOrFail(routineId, user);
  }

  async updateExercise(
    user: Actor,
    routineExerciseId: string,
    input: UpdateRoutineExerciseInput,
  ): Promise<RoutineResponse> {
    const routineExercise = await this.getRoutineExerciseOrFail(routineExerciseId);
    const routine = await this.getRoutineModelOrFail(routineExercise.routineId);
    await this.access.assertCanEdit(user, routine);
    try {
      await this.sequelize.transaction(async (transaction) => {
        await this.repository.updateRoutineExercise(routineExercise, input, transaction);
        await this.structure.afterStructureChange(routine, transaction);
      });
    } catch (error: unknown) {
      throw this.translateConflict(error, 'El orden ya existe en esta rutina.');
    }
    return this.getRoutineOrFail(routine.id, user);
  }

  async deleteExercise(user: Actor, routineExerciseId: string): Promise<RoutineResponse> {
    const routineExercise = await this.getRoutineExerciseOrFail(routineExerciseId);
    const routine = await this.getRoutineModelOrFail(routineExercise.routineId);
    await this.access.assertCanEdit(user, routine);
    await this.sequelize.transaction(async (transaction) => {
      await this.repository.deleteRoutineExercise(routineExerciseId, transaction);
      await this.structure.afterStructureChange(routine, transaction);
    });
    return this.getRoutineOrFail(routine.id, user);
  }

  /**
   * El cliente programa una rutina en su propia semana. Sólo exige que la
   * rutina le sea visible: no puede convertir en suya una rutina privada de
   * otro, pero sí planificar cualquiera del catálogo compartido.
   */
  async selfScheduleRoutine(
    user: Actor,
    routineId: string,
    input: SelfScheduleRoutineInput,
  ): Promise<RoutineAssignmentResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.access.assertFullView(user, routine);

    const assignment = await this.repository.upsertSelfAssignment(
      routineId,
      user.id,
      input,
    );
    const hydrated = await this.repository.findAssignmentById(assignment.id);
    return mapAssignmentToResponse(hydrated ?? assignment);
  }

  async assignRoutine(
    coach: Actor,
    routineId: string,
    input: AssignRoutineInput,
  ): Promise<RoutineAssignmentResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.access.assertCanEdit(coach, routine);

    const client = await this.repository.findClientById(input.clientUserId);
    if (!client || client.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('Cliente no encontrado o inactivo.');
    }
    if (client.id === coach.id) {
      throw new BadRequestException('No puedes asignarte una rutina a ti mismo como coach.');
    }

    try {
      const assignment = await this.sequelize.transaction(async (transaction) => {
        const created = await this.repository.createAssignment(routineId, coach.id, input, transaction);
        // D15: la asignación del entrenador aparece como compartida ya aceptada.
        await this.repository.ensureCoachShare(routineId, coach.id, client.id, transaction);
        return created;
      });
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
    user: Actor,
    input: ImportRoutinesInput,
  ): Promise<{ resultados: ImportRoutineResult[]; creadas: number }> {
    const results: ImportRoutineResult[] = [];

    for (const [index, routineInput] of input.routines.entries()) {
      const visibility = this.normalizeVisibility(user.role, routineInput.visibility);
      try {
        const routineId = await this.sequelize.transaction(async (transaction) => {
          const routine = await this.repository.createRoutine(
            user.id,
            {
              name: routineInput.name,
              description: routineInput.description,
              visibility,
              goal: routineInput.goal,
              durationWeeks: null,
              progression: null,
            },
            user.tenantId ?? null,
            transaction,
          );
          const dayId = await this.days.firstDayId(routine.id, transaction);
          for (const exercise of routineInput.exercises) {
            const exerciseId = await this.resolveExerciseId(exercise, user.id);
            await this.repository.addExercise(routine.id, exerciseId, exercise, dayId, transaction);
          }
          await this.structure.afterStructureChange(routine, transaction);
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

  /**
   * Empieza una sesión con los ejercicios de UN día: el pedido, el que toca hoy
   * según el día de la semana, o el primero. Una rutina de varios días no debe
   * volcar toda la semana en una sola sesión.
   */
  async startSessionFromRoutine(
    user: Actor,
    routineId: string,
    routineDayId?: string,
  ): Promise<WorkoutSessionResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    await this.access.assertFullView(user, routine);
    const day = await this.pickDay(routine, routineDayId);

    const session = await this.workoutsService.startSession(user.id, {
      observation: `Plan: ${routine.name}${day?.name ? ` · ${day.name}` : ''}`,
    });

    await this.workoutsService.linkSession(user.id, session.id, {
      routineId: routine.id,
      routineDayId: day?.id ?? null,
      programId: await this.repository.findActiveProgramIdForRoutine(user.id, routine.id),
    });

    const exercises = [...(routine.exercises ?? [])]
      .filter((e) => !day || e.routineDayId === day.id)
      .sort((a, b) => a.order - b.order);
    for (const [index, exercise] of exercises.entries()) {
      await this.workoutsService.addExerciseToSession(user.id, session.id, {
        exerciseId: exercise.exerciseId,
        order: index + 1,
        isEmphasis: false,
        note: exercise.note,
      });
    }

    return this.workoutsService.getMySession(user.id, session.id);
  }

  private async pickDay(routine: RoutineModel, requested?: string) {
    const days = [...(routine.days ?? [])].sort((a, b) => a.order - b.order);
    if (requested) {
      const found = days.find((d) => d.id === requested);
      if (!found) throw new NotFoundException('Día de la rutina no encontrado.');
      return found;
    }
    const jsDay = new Date().getDay();
    const isoToday = jsDay === 0 ? 7 : jsDay;
    return days.find((d) => d.weekday === isoToday) ?? days[0] ?? null;
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

  private async getRoutineOrFail(routineId: string, viewer: Actor): Promise<RoutineResponse> {
    const routine = await this.getRoutineModelOrFail(routineId);
    return mapRoutineToResponse(routine, this.viewerOf(viewer, routine));
  }

  private viewerOf(user: Actor, routine: RoutineModel) {
    return { id: user.id, canEdit: canEditRoutine(user, routine) };
  }

  private async getRoutineExerciseOrFail(id: string): Promise<RoutineExerciseModel> {
    const routineExercise = await this.repository.findRoutineExerciseById(id);
    if (!routineExercise) throw new NotFoundException('Ejercicio de rutina no encontrado.');
    return routineExercise;
  }

  /**
   * Al crear o editar solo se admite PRIVATE (o SHARED por compatibilidad).
   * PUBLIC se alcanza únicamente publicando (valida y comprueba duplicados) y
   * TEMPLATE, que ya no existe, se trata como PRIVATE para no romper a las
   * apps instaladas que todavía lo envían.
   */
  private normalizeVisibility(_role: UserRole, visibility: RoutineVisibility): RoutineVisibility {
    if (visibility === RoutineVisibility.PUBLIC) {
      throw new BadRequestException('Para hacer pública una rutina usa «Publicar».');
    }
    return visibility === RoutineVisibility.TEMPLATE ? RoutineVisibility.PRIVATE : visibility;
  }

  private translateConflict(error: unknown, message: string): unknown {
    const name = error instanceof Error ? error.name : '';
    if (name === 'SequelizeUniqueConstraintError') {
      return new ConflictException(message);
    }
    return error;
  }
}

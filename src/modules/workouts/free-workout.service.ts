import { ConflictException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { ExercisesService } from '../exercises/exercises.service';
import {
  FULL_BODY,
  FreeWorkoutGroup,
  SwapReason,
  freeWorkoutTargets,
  omitReasonFor,
  planFreeWorkout,
  rankAlternatives,
  remainingSets,
} from './free-workout';
import { AlternativesQueryInput, StartFreeWorkoutInput, SwapSessionExerciseInput } from './free-workout.schemas';
import { SessionEditsRepository } from './session-edits.repository';
import { WorkoutCatalogRepository } from './workout-catalog.repository';
import { WorkoutSessionResponse } from './workout.mapper';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

/** Margen de candidatos por zona: suficientes para no repetir y para rellenar huecos. */
const CANDIDATE_MARGIN = 2;

export type FreeWorkoutResponse = WorkoutSessionResponse & {
  rutinaLibre: { grupos: FreeWorkoutGroup[]; propuestos: number; cuerpoCompleto: boolean };
};

export type AlternativeResponse = {
  id: string;
  nombre: string;
  grupoMuscular: string;
  equipo: string | null;
  imagenUrl: string | null;
  musculosPrincipalesCompartidos: number;
};

/** Lo que el cambio dejó hecho en la sesión, para que el módulo de rutinas siga. */
export type SessionSwapOutcome = {
  sessionId: string;
  sessionExerciseId: string;
  fromExerciseId: string;
  routineExerciseId: string | null;
  /** El ejercicio ya tenía series: se conservó y se añadió el nuevo detrás. */
  splitAfterSets: boolean;
};

/**
 * Rutina libre (zonas opcionales → sesión propuesta y editable) y cambio de
 * ejercicio por un equivalente, con motivo. Lo que toca la rutina vive en el
 * módulo de rutinas (`SessionSwapService`): `workouts` no conoce las rutinas.
 */
@Injectable()
export class FreeWorkoutService {
  constructor(
    private readonly workouts: WorkoutsService,
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly catalog: WorkoutCatalogRepository,
    private readonly edits: SessionEditsRepository,
    private readonly exercises: ExercisesService,
    private readonly sequelize: Sequelize,
  ) {}

  async startFree(userId: string, input: StartFreeWorkoutInput): Promise<FreeWorkoutResponse> {
    const fullBody = input.groups.length === 0;
    const groups = fullBody ? [...FULL_BODY] : input.groups;
    if (input.empty) {
      const session = await this.workouts.startSession(userId, { observation: input.observation });
      return { ...session, rutinaLibre: { grupos: [], propuestos: 0, cuerpoCompleto: false } };
    }

    const perGroup = Math.ceil(input.size / groups.length) + CANDIDATE_MARGIN;
    const candidates = await this.catalog.candidatesByGroup(userId, groups, perGroup);
    const plan = planFreeWorkout(groups, candidates, input.size);

    const sessionId = await this.createWithExercises(userId, input.observation, plan);
    const session = await this.workouts.getMySession(userId, sessionId);
    return {
      ...session,
      rutinaLibre: { grupos: fullBody ? [] : groups, propuestos: plan.length, cuerpoCompleto: fullBody },
    };
  }

  async listAlternatives(
    userId: string,
    sessionExerciseId: string,
    query: AlternativesQueryInput,
  ): Promise<{ ejercicioId: string; motivo: SwapReason | null; alternativas: AlternativeResponse[] }> {
    const sessionExercise = await this.ownedSessionExercise(userId, sessionExerciseId);
    const session = await this.workouts.getSessionModelForUser(userId, sessionExercise.sessionId);
    const inSession = (session.sessionExercises ?? []).map((item) => item.exerciseId);
    const [rows, equipment] = await Promise.all([
      this.catalog.alternativesFor(userId, sessionExercise.exerciseId, inSession, query.limit),
      this.catalog.exerciseEquipment(sessionExercise.exerciseId),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ranked = rankAlternatives(rows, equipment, query.reason)
      .map((row) => byId.get(row.id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);
    return {
      ejercicioId: sessionExercise.exerciseId,
      motivo: query.reason ?? null,
      alternativas: ranked.map((row) => ({
        id: row.id,
        nombre: row.name,
        grupoMuscular: row.muscleGroup,
        equipo: row.equipment,
        imagenUrl: row.imageUrl,
        musculosPrincipalesCompartidos: row.sharedPrimary,
      })),
    };
  }

  /**
   * Cambia el ejercicio dentro de la sesión, en la transacción de quien llama.
   *
   * - Sin series hechas: se sustituye en su sitio, con el mismo objetivo.
   * - Con series hechas: esas series son historia y se quedan con el ejercicio
   *   original, que se marca omitido para el resto; el nuevo entra justo
   *   detrás con las series que faltaban.
   */
  async swapInSession(
    userId: string,
    sessionExerciseId: string,
    input: SwapSessionExerciseInput,
    routineId: string | null,
    transaction: Transaction,
  ): Promise<SessionSwapOutcome> {
    const current = await this.ownedSessionExercise(userId, sessionExerciseId);
    if (current.exerciseId === input.exerciseId) {
      throw new DomainException(HttpStatus.BAD_REQUEST, 'SWAP_SAME_EXERCISE', 'Elige un ejercicio distinto.', {
        sesionEjercicioId: sessionExerciseId,
      });
    }
    await this.exercises.getVisibleExerciseOrFail(input.exerciseId, userId);

    // Se lee antes de escribir: `replaceExercise` actualiza el modelo en memoria
    // y después `current.exerciseId` ya sería el nuevo.
    const fromExerciseId = current.exerciseId;
    const done = (current.sets ?? []).length;
    const target = done === 0 ? current : await this.splitAfterSets(current, input, done, transaction);
    if (done === 0) await this.edits.replaceExercise(current, input.exerciseId, transaction);

    await this.edits.logSwap(
      {
        userId,
        sessionId: current.sessionId,
        sessionExerciseId: target.id,
        fromExerciseId,
        toExerciseId: input.exerciseId,
        reason: input.reason,
        note: input.note,
        scope: input.scope,
        routineId,
      },
      transaction,
    );
    return {
      sessionId: current.sessionId,
      sessionExerciseId: target.id,
      fromExerciseId,
      routineExerciseId: current.routineExerciseId,
      splitAfterSets: done > 0,
    };
  }

  private async splitAfterSets(
    current: WorkoutSessionExerciseModel,
    input: SwapSessionExerciseInput,
    done: number,
    transaction: Transaction,
  ): Promise<WorkoutSessionExerciseModel> {
    await this.edits.omit(current, omitReasonFor(input.reason), input.note, transaction);
    await this.edits.openSlotAfter(current.sessionId, current.order, transaction);
    return this.edits.createOne(
      current.sessionId,
      {
        exerciseId: input.exerciseId,
        order: current.order + 1,
        routineExerciseId: current.routineExerciseId,
        targets: {
          targetSets: remainingSets(current.targetSets, done),
          repsMin: current.repsMin,
          repsMax: current.repsMax,
          // La carga del ejercicio anterior no vale para otro: se deja en blanco.
          targetWeightKg: null,
          targetRir: current.targetRir,
          restSeconds: current.restSeconds,
          restBetweenSeconds: current.restBetweenSeconds,
          durationSeconds: current.durationSeconds,
          group: current.group,
          groupType: current.groupType,
        },
      },
      transaction,
    );
  }

  private async createWithExercises(
    userId: string,
    observation: string | null,
    plan: ReturnType<typeof planFreeWorkout>,
  ): Promise<string> {
    const open = await this.workoutsRepository.findOpenSessionForUser(userId);
    if (open) throw new ConflictException('Ya existe una sesión de entrenamiento en progreso para este usuario.');
    try {
      return await this.sequelize.transaction(async (transaction) => {
        const session = await this.edits.createSession(userId, observation, transaction);
        await this.edits.addExercises(
          session.id,
          plan.map((item, index) => ({
            exerciseId: item.exerciseId,
            order: index + 1,
            targets: freeWorkoutTargets(item.group),
          })),
          transaction,
        );
        return session.id;
      });
    } catch (error: unknown) {
      // La unicidad parcial `uq_active_workout_per_user` es el candado real ante dos toques.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('Ya existe una sesión de entrenamiento en progreso para este usuario.');
      }
      throw error;
    }
  }

  private async ownedSessionExercise(userId: string, sessionExerciseId: string): Promise<WorkoutSessionExerciseModel> {
    const sessionExercise = await this.workoutsRepository.findSessionExerciseById(sessionExerciseId);
    if (!sessionExercise || sessionExercise.session?.userId !== userId) {
      throw new NotFoundException('Ejercicio de sesión no encontrado.');
    }
    if (sessionExercise.session?.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new ForbiddenException('Solo se puede modificar una sesión en progreso.');
    }
    return sessionExercise;
  }
}

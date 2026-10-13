import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { ExercisesService } from '../exercises/exercises.service';
import { FacilitiesRepository } from '../facilities/facilities.repository';
import { ProgressionService, SessionRewardView } from '../progression/progression.service';
import { SessionHooksRegistry } from './session-hooks';
import { resolveVerifiedBranch } from './geo-verification.util';
import {
  mapSessionExerciseToResponse,
  mapWorkoutSessionToResponse,
  mapSkippedSetToResponse,
  mapWorkoutSetToResponse,
  WorkoutSessionExerciseResponse,
  WorkoutSessionPageResponse,
  WorkoutSessionResponse,
  WorkoutSetResponse,
  WorkoutSkippedSetResponse,
} from './workout.mapper';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { SessionExerciseTargets, WorkoutsRepository } from './workouts.repository';
import {
  AddSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutSetInput,
  FinishSessionInput,
  MAX_TIMED_SET_SECONDS,
  OmitSessionExerciseInput,
  RestSettingsInput,
  SkipSetInput,
  UpdateSessionExerciseInput,
  UpdateWorkoutSetInput,
  WorkoutSessionListInput,
} from './workouts.schemas';

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly exercisesService: ExercisesService,
    private readonly facilitiesRepository: FacilitiesRepository,
    private readonly sequelize: Sequelize,
    private readonly progressionService: ProgressionService,
    private readonly hooks: SessionHooksRegistry,
  ) {}

  /** Vincula la sesión con la rutina, el día y el programa de los que nació. */
  async linkSession(
    userId: string,
    sessionId: string,
    link: { routineId: string; routineDayId: string | null; programId: string | null },
  ): Promise<void> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    await session.update(link);
  }

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

    try {
      const session = await this.workoutsRepository.createSession(userId, input);
      return mapWorkoutSessionToResponse(session);
    } catch (error: unknown) {
      // Two concurrent requests can both pass the check above before either
      // inserts. The `uq_active_workout_per_user` partial unique index is the
      // real guard; without translating its violation the loser of the race
      // received a 500 instead of the same 409 a sequential caller gets.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          'Ya existe una sesión de entrenamiento en progreso para este usuario.',
        );
      }

      throw error;
    }
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

  /**
   * Cierra la sesión. Es idempotente: una sesión ya finalizada devuelve la misma
   * respuesta que la primera vez (`yaFinalizada: true`) en vez de un 403. El
   * cierre real lo gana una sola petición (`claimSessionClose`); la otra de un
   * doble toque espera a que el resultado esté guardado y lo repite.
   */
  async finishSession(
    userId: string,
    tenantId: string,
    sessionId: string,
    location: FinishSessionInput = {},
  ): Promise<
    WorkoutSessionResponse & { progression: SessionRewardView | null } & Record<string, unknown>
  > {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    if (session.status === WorkoutSessionStatus.COMPLETED) {
      return this.repeatCloseResult(userId, sessionId);
    }
    this.assertSessionInProgress(session.status);
    const verifiedBranch = await this.resolveGeoVerification(location, tenantId);
    const before = await this.progressionSnapshot(userId);
    const claimed = await this.workoutsRepository.claimSessionClose(
      session,
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: verifiedBranch !== null, verifiedBranchId: verifiedBranch?.id ?? null },
    );
    if (!claimed) return this.repeatCloseResult(userId, sessionId);

    const progression = before ? await this.progressionReward(userId, before) : null;
    const extras = await this.hooks.runFinished({ session, userId, tenantId });
    const result = { progression, ...extras };
    // Guardarlo no puede tumbar el cierre: sin él, repetir `finish` solo pierde el premio.
    await this.workoutsRepository
      .saveCloseResult(sessionId, JSON.parse(JSON.stringify(result)) as Record<string, unknown>)
      .catch(() => undefined);
    return { ...mapWorkoutSessionToResponse(session), ...result };
  }

  /**
   * Respuesta de un `finish` repetido. Si la petición que cerró todavía está
   * calculando el premio, se espera un momento a que lo guarde: devolver
   * `progression: null` haría que la app enseñara «+0 puntos» tras un doble toque.
   */
  private async repeatCloseResult(
    userId: string,
    sessionId: string,
  ): Promise<
    WorkoutSessionResponse & { progression: SessionRewardView | null } & Record<string, unknown>
  > {
    let stored: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < CLOSE_RESULT_ATTEMPTS; attempt += 1) {
      const row = await this.workoutsRepository.findCloseResult(sessionId);
      if (row?.closeResult) {
        stored = row.closeResult;
        break;
      }
      if (attempt < CLOSE_RESULT_ATTEMPTS - 1) await delay(CLOSE_RESULT_WAIT_MS);
    }
    const session = await this.getSessionModelOrFail(userId, sessionId);
    const result = (stored ?? {}) as { progression?: SessionRewardView | null } & Record<
      string,
      unknown
    >;
    return {
      ...mapWorkoutSessionToResponse(session),
      ...result,
      progression: result.progression ?? null,
      yaFinalizada: true,
    };
  }

  /**
   * La recompensa es un añadido: si la senda falla, la sesión se cierra igual.
   * Perder un entrenamiento porque no se pudo contar su premio sería peor que
   * no enseñar el premio.
   */
  private async progressionSnapshot(userId: string) {
    try {
      return await this.progressionService.snapshot(userId);
    } catch {
      return null;
    }
  }

  private async progressionReward(
    userId: string,
    before: Awaited<ReturnType<ProgressionService['snapshot']>>,
  ): Promise<SessionRewardView | null> {
    try {
      return await this.progressionService.recordSessionReward(userId, before);
    } catch {
      return null;
    }
  }

  /**
   * Transparente para quien entrena: sin coordenadas, o sin ninguna sede
   * configurada con radio, la sesión se finaliza igual y sin verificar. No es
   * una condición para que cuente, es un dato adicional cuando está disponible.
   *
   * Se verifica contra las sedes del gimnasio de quien entrena: dar por buena
   * la coordenada de una sede ajena sería marcar como presencial una sesión que
   * ocurrió en un gimnasio que no es el suyo.
   */
  private async resolveGeoVerification(
    location: FinishSessionInput,
    tenantId: string,
  ) {
    if (location.latitude === undefined || location.longitude === undefined) return null;

    const branches =
      await this.facilitiesRepository.findActiveBranchesWithCoordinates(tenantId);
    const candidates = branches
      .filter((branch) => branch.latitude !== null && branch.longitude !== null && branch.geofenceRadiusM !== null)
      .map((branch) => ({
        id: branch.id,
        latitude: Number(branch.latitude),
        longitude: Number(branch.longitude),
        geofenceRadiusM: branch.geofenceRadiusM as number,
      }));

    return resolveVerifiedBranch(candidates, {
      latitude: location.latitude,
      longitude: location.longitude,
    });
  }

  async cancelSession(
    userId: string,
    sessionId: string,
  ): Promise<WorkoutSessionResponse> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    // Cancelar dos veces (doble toque) no es un error: ya está cancelada.
    if (session.status === WorkoutSessionStatus.CANCELLED) {
      return mapWorkoutSessionToResponse(session);
    }
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
    targets?: SessionExerciseTargets,
  ): Promise<WorkoutSessionExerciseResponse> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    this.assertSessionInProgress(session.status);
    await this.exercisesService.getVisibleExerciseOrFail(input.exerciseId, userId);

    try {
      const sessionExercise = await this.workoutsRepository.addExerciseToSession(
        sessionId,
        input,
        targets,
      );
      return mapSessionExerciseToResponse(sessionExercise);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          'El orden ya existe en esta sesión de entrenamiento.',
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
    assertDurationAllowed(sessionExercise, input);

    try {
      const set = await this.sequelize.transaction(async (transaction) => {
        const duplicatedSet =
          await this.workoutsRepository.findSetBySessionExerciseAndNumber(
            sessionExerciseId,
            input.setNumber,
            transaction,
          );

        if (duplicatedSet) {
          // Doble toque en «Registrar serie»: la misma serie, hace un momento.
          if (isSameRecentSet(duplicatedSet, input)) return duplicatedSet;
          throw new ConflictException(
            'Ya existe una serie con ese número para este ejercicio de la sesión.',
          );
        }

        // Si esa serie estaba marcada como saltada, al hacerla deja de estarlo.
        await this.workoutsRepository.deleteSkippedSetByNumber(
          sessionExerciseId,
          input.setNumber,
          transaction,
        );
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
    assertSameSetKind(set, input);
    try {
      const updatedSet = await this.workoutsRepository.updateSet(set, input);
      return mapWorkoutSetToResponse(updatedSet);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          'Ya existe una serie con ese número para este ejercicio de la sesión.',
        );
      }
      throw error;
    }
  }

  async deleteSet(userId: string, setId: string): Promise<{ deleted: true }> {
    const set = await this.getSetOwnedByUserOrFail(userId, setId);
    this.assertSessionInProgress(set.sessionExercise?.session?.status);
    await this.workoutsRepository.deleteSet(set.id);
    return { deleted: true };
  }

  /** Marca una serie como saltada, con su motivo (D1). Repetirlo corrige el motivo. */
  async skipSet(
    userId: string,
    sessionExerciseId: string,
    input: SkipSetInput,
  ): Promise<WorkoutSkippedSetResponse> {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(
      userId,
      sessionExerciseId,
    );
    this.assertSessionInProgress(sessionExercise.session?.status);
    const done = (sessionExercise.sets ?? []).find((set) => set.setNumber === input.setNumber);
    if (done) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'SET_NUMBER_TAKEN',
        'Esa serie ya está registrada; no se puede saltar.',
        { setId: done.id },
      );
    }
    try {
      const skipped = await this.workoutsRepository.upsertSkippedSet(sessionExerciseId, input);
      return mapSkippedSetToResponse(skipped);
    } catch (error: unknown) {
      // Dos toques a la vez: el segundo choca con la unicidad y lee la fila del primero.
      if (!(error instanceof UniqueConstraintError)) throw error;
      const skipped = await this.workoutsRepository.upsertSkippedSet(sessionExerciseId, input);
      return mapSkippedSetToResponse(skipped);
    }
  }

  async unskipSet(userId: string, skippedSetId: string): Promise<{ deleted: true }> {
    const skipped = await this.workoutsRepository.findSkippedSetById(skippedSetId);
    if (!skipped || skipped.sessionExercise?.session?.userId !== userId) {
      throw new NotFoundException('Serie saltada no encontrada.');
    }
    this.assertSessionInProgress(skipped.sessionExercise?.session?.status);
    await this.workoutsRepository.deleteSkippedSet(skipped.id);
    return { deleted: true };
  }

  /** Omite (o recupera, con `null`) un ejercicio entero de la sesión (D1). */
  async setExerciseOmitted(
    userId: string,
    sessionExerciseId: string,
    input: OmitSessionExerciseInput | null,
  ): Promise<WorkoutSessionExerciseResponse> {
    const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(
      userId,
      sessionExerciseId,
    );
    this.assertSessionInProgress(sessionExercise.session?.status);
    await this.workoutsRepository.setOmitted(sessionExercise, input);
    const fresh = await this.workoutsRepository.findSessionExerciseWithExercise(sessionExerciseId);
    return mapSessionExerciseToResponse(fresh ?? sessionExercise);
  }

  /**
   * Aplica descanso e intervalo a ejercicios de la sesión (D2) y devuelve los
   * ejercicios tocados, para que quien llama (el módulo de rutinas) decida si
   * además los guarda en la rutina. Va dentro de la transacción de quien llama.
   */
  async applyRestSettings(
    userId: string,
    sessionId: string,
    changes: RestSettingsInput['changes'],
    transaction: Transaction,
  ): Promise<{ session: WorkoutSessionModel; touched: WorkoutSessionExerciseModel[] }> {
    const session = await this.getSessionModelOrFail(userId, sessionId);
    this.assertSessionInProgress(session.status);
    const byId = new Map((session.sessionExercises ?? []).map((item) => [item.id, item]));
    const touched: WorkoutSessionExerciseModel[] = [];
    for (const { sessionExerciseId, ...change } of changes) {
      const sessionExercise = byId.get(sessionExerciseId);
      if (!sessionExercise) throw new NotFoundException('Ejercicio de sesión no encontrado.');
      assertRestChangeAllowed(sessionExercise, change);
      await this.workoutsRepository.updateSessionExerciseRest(sessionExercise, change, transaction);
      touched.push(sessionExercise);
    }
    return { session, touched };
  }

  /** La sesión (con su rutina de origen) de quien llama, o 404. */
  getSessionModelForUser(userId: string, sessionId: string): Promise<WorkoutSessionModel> {
    return this.getSessionModelOrFail(userId, sessionId);
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

/** Cuánto se espera a que la petición que cerró la sesión guarde su resultado. */
const CLOSE_RESULT_ATTEMPTS = 12;
const CLOSE_RESULT_WAIT_MS = 250;

/** Margen para considerar un segundo `POST …/sets` idéntico como un doble toque. */
const DUPLICATE_SET_WINDOW_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ¿Es la misma serie que se acaba de registrar? Mismo contenido y reciente:
 * un reintento del cliente, no una serie distinta con el número repetido.
 */
function isSameRecentSet(existing: WorkoutSetModel, input: CreateWorkoutSetInput): boolean {
  if (Date.now() - existing.createdAt.getTime() > DUPLICATE_SET_WINDOW_MS) return false;
  if ((existing.type ?? 'FUERZA') !== input.type) return false;
  const sameNumber = (stored: string | number | null | undefined, sent: number | null) =>
    (stored == null ? null : Number(stored)) === (sent ?? null);
  if (input.type === 'CARDIO') {
    return (
      sameNumber(existing.durationSeconds, input.durationSeconds) &&
      sameNumber(existing.distanceM, input.distanceM)
    );
  }
  return (
    sameNumber(existing.repetitions, input.repetitions) &&
    sameNumber(existing.weightKg, input.weightKg) &&
    sameNumber(existing.rir, input.rir) &&
    sameNumber(existing.durationSeconds, input.durationSeconds)
  );
}

/**
 * `descansoEntreSeg` solo tiene sentido dentro de un bloque (superserie o
 * circuito) y `duracionSeg` solo en un ejercicio por tiempo: aceptarlos en
 * otro sitio convertiría el ejercicio en algo que no es.
 */
function assertRestChangeAllowed(
  sessionExercise: WorkoutSessionExerciseModel,
  change: { restBetweenSeconds?: number; durationSeconds?: number },
): void {
  const invalid =
    change.restBetweenSeconds !== undefined && sessionExercise.group == null
      ? 'descansoEntreSeg'
      : change.durationSeconds !== undefined && sessionExercise.durationSeconds == null
        ? 'duracionSeg'
        : null;
  if (!invalid) return;
  throw new DomainException(
    HttpStatus.BAD_REQUEST,
    'REST_SETTING_INVALID',
    invalid === 'descansoEntreSeg'
      ? 'El descanso entre ejercicios solo aplica a una superserie o circuito.'
      : 'Este ejercicio se hace por repeticiones, no por tiempo.',
    { sesionEjercicioId: sessionExercise.id, campo: invalid },
  );
}

/**
 * Una serie de fuerza por tiempo solo vale si el ejercicio de la sesión es por
 * tiempo (`duracionSeg` copiado de la rutina). Sin objetivo de tiempo el
 * ejercicio es por repeticiones, y una serie sin repeticiones lo rompería todo
 * lo que suma kilos por repeticiones.
 */
function assertDurationAllowed(
  sessionExercise: WorkoutSessionExerciseModel,
  input: CreateWorkoutSetInput,
): void {
  if (input.type !== 'FUERZA' || input.durationSeconds == null) return;
  if (sessionExercise.durationSeconds != null) return;
  throw new DomainException(
    HttpStatus.BAD_REQUEST,
    'SET_DURATION_NOT_ALLOWED',
    'Este ejercicio se registra por repeticiones, no por tiempo.',
    { sessionExerciseId: sessionExercise.id },
  );
}

/**
 * Editar una serie no cambia su forma: una serie por repeticiones no acepta
 * duración ni una por tiempo repeticiones (para cambiarla, se borra y se crea
 * otra). Así el CHECK `ck_serie_por_tipo` nunca salta como un 500.
 */
function assertSameSetKind(set: WorkoutSetModel, input: UpdateWorkoutSetInput): void {
  if (set.type !== 'FUERZA') return;
  const timed = set.repetitions == null;
  const mismatch = timed ? input.repetitions !== undefined : input.durationSeconds !== undefined;
  const tooLong =
    timed && input.durationSeconds !== undefined && input.durationSeconds > MAX_TIMED_SET_SECONDS;
  if (!mismatch && !tooLong) return;
  throw new DomainException(
    HttpStatus.BAD_REQUEST,
    'SET_KIND_MISMATCH',
    timed
      ? `Una serie por tiempo solo admite una duración de 1 a ${MAX_TIMED_SET_SECONDS} s.`
      : 'Una serie por repeticiones no admite duración.',
    { setId: set.id },
  );
}

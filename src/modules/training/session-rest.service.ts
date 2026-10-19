import { HttpStatus, Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { RoutineStatus, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutSessionExerciseModel } from '../workouts/workout-session-exercise.model';
import { WorkoutSessionModel } from '../workouts/workout-session.model';
import { RestSettingsInput } from '../workouts/workouts.schemas';
import { WorkoutsService } from '../workouts/workouts.service';
import { canEditRoutine } from './routine-access.policy';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineStructureService } from './routine-structure.service';
import { RoutineModel } from './routine.model';
import { TrainingRepository } from './training.repository';

type Actor = { id: string; role: UserRole; tenantId?: string };

/** Qué pasó con «Guardar en mi rutina». `motivo` es `null` cuando se guardó. */
export type RoutineRestSaveResult = {
  guardado: boolean;
  rutinaId: string | null;
  ejerciciosActualizados: number;
  motivo: 'NO_SOLICITADO' | 'SIN_RUTINA' | null;
};

export type SessionRoutineLink = {
  rutinaId: string | null;
  rutinaDiaId: string | null;
  nombre: string | null;
  /** Si «Guardar en mi rutina» está disponible para quien entrena. */
  editable: boolean;
};

/**
 * Descanso e intervalo ajustados a mano durante el entreno (D2).
 *
 * Vive en el módulo de rutinas y no en `workouts` porque puede escribir en la
 * rutina, y `workouts` no conoce las rutinas (la dependencia va en este sentido).
 */
@Injectable()
export class SessionRestService {
  constructor(
    private readonly workouts: WorkoutsService,
    private readonly routines: TrainingRepository,
    private readonly structure: RoutineStructureService,
    private readonly sequelize: Sequelize,
  ) {}

  async routineLink(user: Actor, sessionId: string): Promise<SessionRoutineLink> {
    const session = await this.workouts.getSessionModelForUser(user.id, sessionId);
    const routine = await this.liveRoutineOf(session);
    return {
      rutinaId: routine?.id ?? null,
      rutinaDiaId: routine ? (session.routineDayId ?? null) : null,
      nombre: routine?.name ?? null,
      editable: routine ? canEditRoutine(user, routine) : false,
    };
  }

  async apply(
    user: Actor,
    sessionId: string,
    input: RestSettingsInput,
  ): Promise<{ sesion: WorkoutSessionResponse; rutina: RoutineRestSaveResult }> {
    const session = await this.workouts.getSessionModelForUser(user.id, sessionId);
    const routine = input.saveToRoutine ? await this.liveRoutineOf(session) : null;
    // Se comprueba ANTES de tocar nada: una rutina ajena no debe dejar la sesión a medias.
    if (routine && !canEditRoutine(user, routine)) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        'ROUTINE_NOT_OWNED',
        'Guarda la rutina en tus rutinas para cambiar sus descansos.',
        { routineId: routine.id },
      );
    }

    let updated = 0;
    await this.sequelize.transaction(async (transaction) => {
      const { touched } = await this.workouts.applyRestSettings(
        user.id,
        sessionId,
        input.changes,
        transaction,
      );
      if (routine) updated = await this.saveToRoutine(routine, session, touched, transaction);
    });

    return {
      sesion: await this.workouts.getMySession(user.id, sessionId),
      rutina: {
        guardado: routine !== null,
        rutinaId: routine?.id ?? null,
        ejerciciosActualizados: updated,
        motivo: routine ? null : input.saveToRoutine ? 'SIN_RUTINA' : 'NO_SOLICITADO',
      },
    };
  }

  /** La rutina de la que nació la sesión, si sigue viva. */
  private async liveRoutineOf(session: WorkoutSessionModel): Promise<RoutineModel | null> {
    if (!session.routineId) return null;
    const routine = await this.routines.findRoutineById(session.routineId);
    return routine && routine.status === RoutineStatus.ACTIVE ? routine : null;
  }

  /**
   * Escribe en la rutina lo que ya quedó en cada ejercicio de la sesión.
   *
   * La sesión no guarda de qué fila de la rutina salió cada ejercicio, así que
   * se empareja por día y ejercicio; si el mismo ejercicio está dos veces en el
   * día, por orden de aparición (la sesión se creó en ese mismo orden).
   */
  private async saveToRoutine(
    routine: RoutineModel,
    session: WorkoutSessionModel,
    touched: readonly WorkoutSessionExerciseModel[],
    transaction: Transaction,
  ): Promise<number> {
    const dayExercises = [...(routine.exercises ?? [])]
      .filter((item) => !session.routineDayId || item.routineDayId === session.routineDayId)
      .sort((a, b) => a.order - b.order);
    const sessionExercises = [...(session.sessionExercises ?? [])].sort((a, b) => a.order - b.order);

    let updated = 0;
    let structureChanged = false;
    for (const sessionExercise of touched) {
      const occurrence = sessionExercises
        .filter((item) => item.exerciseId === sessionExercise.exerciseId)
        .findIndex((item) => item.id === sessionExercise.id);
      const target = dayExercises.filter((item) => item.exerciseId === sessionExercise.exerciseId)[
        Math.max(occurrence, 0)
      ];
      if (!target) continue; // ejercicio añadido a mano en la sesión: no está en la rutina
      const changes = routineChanges(target, sessionExercise);
      if (Object.keys(changes).length === 0) continue;
      if ('durationSeconds' in changes) structureChanged = true;
      await target.update(changes, { transaction });
      updated += 1;
    }
    // La duración de la serie entra en la huella; el descanso no.
    if (structureChanged) await this.structure.afterStructureChange(routine, transaction);
    return updated;
  }
}

/** Solo lo que de verdad cambia, y solo donde tiene sentido en la rutina. */
function routineChanges(
  target: RoutineExerciseModel,
  sessionExercise: WorkoutSessionExerciseModel,
): Partial<Pick<RoutineExerciseModel, 'restSeconds' | 'restBetweenSeconds' | 'durationSeconds'>> {
  const changes: Partial<
    Pick<RoutineExerciseModel, 'restSeconds' | 'restBetweenSeconds' | 'durationSeconds'>
  > = {};
  if (sessionExercise.restSeconds != null && sessionExercise.restSeconds !== target.restSeconds) {
    changes.restSeconds = sessionExercise.restSeconds;
  }
  if (
    target.group != null &&
    sessionExercise.restBetweenSeconds != null &&
    sessionExercise.restBetweenSeconds !== target.restBetweenSeconds
  ) {
    changes.restBetweenSeconds = sessionExercise.restBetweenSeconds;
  }
  if (
    target.durationSeconds != null &&
    sessionExercise.durationSeconds != null &&
    sessionExercise.durationSeconds !== target.durationSeconds
  ) {
    changes.durationSeconds = sessionExercise.durationSeconds;
  }
  return changes;
}

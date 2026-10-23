import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { ExercisesService } from '../exercises/exercises.service';
import { FreeWorkoutService } from './free-workout.service';
import { SessionEditsRepository } from './session-edits.repository';
import { WorkoutCatalogRepository } from './workout-catalog.repository';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

const owner = '00000000-0000-4000-8000-000000000001';
const stranger = '00000000-0000-4000-8000-000000000002';
const oldExercise = '00000000-0000-4000-8000-0000000000aa';
const newExercise = '00000000-0000-4000-8000-0000000000bb';
const transaction = {} as Transaction;
const ORDER = 2;
const NEXT_ORDER = 3;
const TARGET_SETS = 4;
const REMAINING_SETS = 3;
const REPS_MIN = 8;
const REPS_MAX = 10;
const RIR = 2;
const REST = 90;
const input = { exerciseId: newExercise, reason: 'MAQUINA_OCUPADA' as const, scope: 'SESION' as const, note: null };

function sessionExercise(overrides: Partial<WorkoutSessionExerciseModel> = {}): WorkoutSessionExerciseModel {
  return {
    id: 'se-1',
    sessionId: 'session-1',
    exerciseId: oldExercise,
    routineExerciseId: 're-1',
    order: ORDER,
    targetSets: TARGET_SETS,
    repsMin: REPS_MIN,
    repsMax: REPS_MAX,
    targetRir: RIR,
    restSeconds: REST,
    restBetweenSeconds: null,
    durationSeconds: null,
    group: null,
    groupType: null,
    sets: [],
    session: { userId: owner, status: WorkoutSessionStatus.IN_PROGRESS },
    ...overrides,
  } as unknown as WorkoutSessionExerciseModel;
}

function build(found: WorkoutSessionExerciseModel | null) {
  const edits = {
    // Como Sequelize: `update` cambia la instancia en memoria.
    replaceExercise: jest.fn((model: WorkoutSessionExerciseModel, exerciseId: string) => {
      Object.assign(model, { exerciseId });
      return Promise.resolve();
    }),
    omit: jest.fn().mockResolvedValue(undefined),
    openSlotAfter: jest.fn().mockResolvedValue(undefined),
    createOne: jest.fn().mockResolvedValue({ id: 'se-new' }),
    logSwap: jest.fn().mockResolvedValue(undefined),
  };
  const service = new FreeWorkoutService(
    {} as WorkoutsService,
    { findSessionExerciseById: jest.fn().mockResolvedValue(found) } as unknown as WorkoutsRepository,
    {} as WorkoutCatalogRepository,
    edits as unknown as SessionEditsRepository,
    { getVisibleExerciseOrFail: jest.fn().mockResolvedValue({}) } as unknown as ExercisesService,
    {} as Sequelize,
  );
  return { service, edits };
}

describe('FreeWorkoutService.swapInSession', () => {
  it('sin series hechas sustituye en su sitio y registra el motivo', async () => {
    const { service, edits } = build(sessionExercise());
    const outcome = await service.swapInSession(owner, 'se-1', input, null, transaction);

    expect(edits.replaceExercise).toHaveBeenCalledWith(expect.objectContaining({ id: 'se-1' }), newExercise, transaction);
    expect(edits.createOne).not.toHaveBeenCalled();
    expect(edits.logSwap).toHaveBeenCalledWith(
      expect.objectContaining({ fromExerciseId: oldExercise, toExerciseId: newExercise, reason: 'MAQUINA_OCUPADA' }),
      transaction,
    );
    expect(outcome).toMatchObject({
      sessionExerciseId: 'se-1',
      splitAfterSets: false,
      routineExerciseId: 're-1',
      fromExerciseId: oldExercise,
    });
  });

  it('con series hechas las conserva, omite el original y añade el nuevo detrás con las que faltan', async () => {
    const { service, edits } = build(sessionExercise({ sets: [{ id: 's1' }] as never }));
    const outcome = await service.swapInSession(owner, 'se-1', input, null, transaction);

    expect(edits.replaceExercise).not.toHaveBeenCalled();
    expect(edits.omit).toHaveBeenCalledWith(expect.anything(), 'EQUIPO_OCUPADO', null, transaction);
    expect(edits.openSlotAfter).toHaveBeenCalledWith('session-1', ORDER, transaction);
    expect(edits.createOne).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        exerciseId: newExercise,
        order: NEXT_ORDER,
        targets: expect.objectContaining({ targetSets: REMAINING_SETS, targetWeightKg: null }),
      }),
      transaction,
    );
    expect(outcome).toMatchObject({ sessionExerciseId: 'se-new', splitAfterSets: true });
  });

  it('no deja cambiar un ejercicio por sí mismo', async () => {
    const { service } = build(sessionExercise());
    await expect(
      service.swapInSession(owner, 'se-1', { ...input, exerciseId: oldExercise }, null, transaction),
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('un ejercicio ajeno responde 404', async () => {
    const { service } = build(sessionExercise({ session: { userId: stranger, status: WorkoutSessionStatus.IN_PROGRESS } } as never));
    await expect(service.swapInSession(owner, 'se-1', input, null, transaction)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una sesión cerrada no se modifica', async () => {
    const { service } = build(sessionExercise({ session: { userId: owner, status: WorkoutSessionStatus.COMPLETED } } as never));
    await expect(service.swapInSession(owner, 'se-1', input, null, transaction)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { FacilitiesRepository } from '../facilities/facilities.repository';
import { ProgressionService } from '../progression/progression.service';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { WorkoutsRepository } from './workouts.repository';
import { SessionHooksRegistry } from './session-hooks';
import { WorkoutsService } from './workouts.service';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const setId = '00000000-0000-4000-8000-000000000003';
const tenantId = 'topfitness';

function createService(
  repositoryOverrides: Partial<WorkoutsRepository>,
  facilitiesOverrides: Partial<FacilitiesRepository> = {},
): WorkoutsService {
  return new WorkoutsService(
    {
      saveCloseResult: jest.fn().mockResolvedValue(undefined),
      ...repositoryOverrides,
    } as WorkoutsRepository,
    {} as ExercisesService,
    {
      findActiveBranchesWithCoordinates: jest.fn().mockResolvedValue([]),
      ...facilitiesOverrides,
    } as unknown as FacilitiesRepository,
    {} as Sequelize,
    {
      snapshot: jest.fn().mockRejectedValue(new Error('sin senda en este test')),
    } as unknown as ProgressionService,
    new SessionHooksRegistry(),
  );
}

function createSet(userId: string, status: WorkoutSessionStatus): WorkoutSetModel {
  return {
    id: setId,
    sessionExercise: {
      session: {
        userId,
        status,
      },
    },
  } as WorkoutSetModel;
}

describe('WorkoutsService ownership and state rules', () => {
  it('does not reveal a set owned by another user', async () => {
    const service = createService({
      findSetById: jest
        .fn()
        .mockResolvedValue(createSet(otherUserId, WorkoutSessionStatus.IN_PROGRESS)),
    });

    await expect(service.deleteSet(ownerId, setId)).rejects.toThrow(NotFoundException);
  });

  it('prevents mutation after a workout session is completed', async () => {
    const service = createService({
      findSetById: jest
        .fn()
        .mockResolvedValue(createSet(ownerId, WorkoutSessionStatus.COMPLETED)),
    });

    await expect(service.updateSet(ownerId, setId, { repetitions: 10 })).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('WorkoutsService.finishSession geo-verification', () => {
  function createInProgressSession(): WorkoutSessionModel {
    return {
      id: 'session-1',
      userId: ownerId,
      status: WorkoutSessionStatus.IN_PROGRESS,
    } as WorkoutSessionModel;
  }

  it('finishes without verification when no location is sent', async () => {
    const claimSessionClose = jest
      .fn()
      .mockImplementation(
        (
          session: WorkoutSessionModel,
          status: WorkoutSessionStatus,
          extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
        ) => ({
          ...session,
          status,
          ...extra,
        }),
      );
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(createInProgressSession()),
      claimSessionClose,
    });

    await service.finishSession(ownerId, tenantId, 'session-1');

    expect(claimSessionClose).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: false, verifiedBranchId: null },
    );
  });

  it('only checks the branches of the gym the member belongs to', async () => {
    const findActiveBranchesWithCoordinates = jest.fn().mockResolvedValue([]);
    const service = createService(
      {
        findSessionByIdForUser: jest.fn().mockResolvedValue(createInProgressSession()),
        claimSessionClose: jest.fn().mockImplementation((session: WorkoutSessionModel) => session),
      },
      { findActiveBranchesWithCoordinates },
    );

    await service.finishSession(ownerId, tenantId, 'session-1', {
      latitude: 0,
      longitude: 0,
    });

    // Sin el gimnasio, la coordenada de una sede ajena daría por presencial una
    // sesión ocurrida en un gimnasio que no es el suyo.
    expect(findActiveBranchesWithCoordinates).toHaveBeenCalledWith(tenantId);
  });

  it('marks the session verified when the point falls inside a configured branch', async () => {
    const claimSessionClose = jest
      .fn()
      .mockImplementation(
        (
          session: WorkoutSessionModel,
          status: WorkoutSessionStatus,
          extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
        ) => ({
          ...session,
          status,
          ...extra,
        }),
      );
    const service = createService(
      {
        findSessionByIdForUser: jest.fn().mockResolvedValue(createInProgressSession()),
        claimSessionClose,
      },
      {
        findActiveBranchesWithCoordinates: jest.fn().mockResolvedValue([
          { id: 'branch-1', latitude: '0.000000', longitude: '0.000000', geofenceRadiusM: 200 },
        ]),
      },
    );

    await service.finishSession(ownerId, tenantId, 'session-1', {
      latitude: 0.0001,
      longitude: 0,
    });

    expect(claimSessionClose).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: true, verifiedBranchId: 'branch-1' },
    );
  });

  it('finishes without verification when the point falls outside every branch radius', async () => {
    const claimSessionClose = jest
      .fn()
      .mockImplementation(
        (
          session: WorkoutSessionModel,
          status: WorkoutSessionStatus,
          extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
        ) => ({
          ...session,
          status,
          ...extra,
        }),
      );
    const service = createService(
      {
        findSessionByIdForUser: jest.fn().mockResolvedValue(createInProgressSession()),
        claimSessionClose,
      },
      {
        findActiveBranchesWithCoordinates: jest.fn().mockResolvedValue([
          { id: 'branch-1', latitude: '0.000000', longitude: '0.000000', geofenceRadiusM: 50 },
        ]),
      },
    );

    await service.finishSession(ownerId, tenantId, 'session-1', {
      latitude: 5,
      longitude: 5,
    });

    expect(claimSessionClose).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: false, verifiedBranchId: null },
    );
  });
});

describe('WorkoutsService concurrent session creation', () => {
  it('reports a conflict when the unique index rejects a racing second session', async () => {
    // Simulates the loser of a race: the pre-check saw no open session because
    // the winner had not committed yet, so the insert hits
    // `uq_active_workout_per_user`.
    const service = createService({
      findOpenSessionForUser: jest.fn().mockResolvedValue(null),
      createSession: jest
        .fn()
        .mockRejectedValue(
          new UniqueConstraintError({ errors: [], fields: { usuario_id: ownerId } }),
        ),
    });

    await expect(service.startSession(ownerId, { observation: null })).rejects.toThrow(ConflictException);
  });

  it('propagates unrelated repository failures instead of masking them as conflicts', async () => {
    const unexpectedFailure = new Error('connection terminated unexpectedly');
    const service = createService({
      findOpenSessionForUser: jest.fn().mockResolvedValue(null),
      createSession: jest.fn().mockRejectedValue(unexpectedFailure),
    });

    await expect(service.startSession(ownerId, { observation: null })).rejects.toThrow(unexpectedFailure);
  });
});

describe('WorkoutsService timed strength sets', () => {
  function inProgress(durationSeconds: number | null) {
    return {
      id: 'se-1',
      durationSeconds,
      session: { userId: ownerId, status: WorkoutSessionStatus.IN_PROGRESS },
    };
  }

  const timedInput = {
    type: 'FUERZA' as const,
    setNumber: 1,
    repetitions: null,
    weightKg: null,
    rir: null,
    durationSeconds: 45,
    previousRestSeconds: 0,
  };

  it('rechaza una serie por tiempo en un ejercicio por repeticiones', async () => {
    const createSetMock = jest.fn();
    const service = createService({
      findSessionExerciseById: jest.fn().mockResolvedValue(inProgress(null)),
      createSet: createSetMock,
    });

    const error: unknown = await service.addSet(ownerId, 'se-1', timedInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('SET_DURATION_NOT_ALLOWED');
    expect(createSetMock).not.toHaveBeenCalled();
  });

  function timedSet(repetitions: number | null) {
    return {
      id: setId,
      type: 'FUERZA',
      repetitions,
      durationSeconds: repetitions == null ? 45 : null,
      sessionExercise: inProgress(45),
    } as unknown as WorkoutSetModel;
  }

  it('no deja poner repeticiones a una serie por tiempo', async () => {
    const service = createService({ findSetById: jest.fn().mockResolvedValue(timedSet(null)) });
    await expect(service.updateSet(ownerId, setId, { repetitions: 10 })).rejects.toMatchObject({
      code: 'SET_KIND_MISMATCH',
    });
  });

  it('no deja poner duración a una serie por repeticiones', async () => {
    const service = createService({ findSetById: jest.fn().mockResolvedValue(timedSet(10)) });
    await expect(service.updateSet(ownerId, setId, { durationSeconds: 30 })).rejects.toMatchObject({
      code: 'SET_KIND_MISMATCH',
    });
  });

  it('no deja una serie por tiempo de más de 3600 s', async () => {
    const service = createService({ findSetById: jest.fn().mockResolvedValue(timedSet(null)) });
    await expect(service.updateSet(ownerId, setId, { durationSeconds: 4000 })).rejects.toMatchObject({
      code: 'SET_KIND_MISMATCH',
    });
  });

  it('edita la duración de una serie por tiempo', async () => {
    const set = timedSet(null);
    const updateSet = jest.fn().mockResolvedValue({ ...set, durationSeconds: 50 });
    const service = createService({ findSetById: jest.fn().mockResolvedValue(set), updateSet });
    await service.updateSet(ownerId, setId, { durationSeconds: 50 });
    expect(updateSet).toHaveBeenCalledWith(set, { durationSeconds: 50 });
  });
});

describe('WorkoutsService idempotent close (doble toque)', () => {
  const stored = { progression: { pointsEarned: 74 }, programa: { semana: 2 } };

  function session(status: WorkoutSessionStatus): WorkoutSessionModel {
    return { id: 'session-1', userId: ownerId, status } as WorkoutSessionModel;
  }

  it('repeats the first response when the session is already finished', async () => {
    const claimSessionClose = jest.fn();
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(session(WorkoutSessionStatus.COMPLETED)),
      findCloseResult: jest
        .fn()
        .mockResolvedValue({ status: WorkoutSessionStatus.COMPLETED, closeResult: stored }),
      claimSessionClose,
    });

    const result = await service.finishSession(ownerId, tenantId, 'session-1');

    expect(claimSessionClose).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ...stored, yaFinalizada: true, estado: WorkoutSessionStatus.COMPLETED });
  });

  it('gives the loser of a simultaneous finish the winner result instead of an empty reward', async () => {
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(session(WorkoutSessionStatus.IN_PROGRESS)),
      claimSessionClose: jest.fn().mockResolvedValue(false),
      findCloseResult: jest
        .fn()
        .mockResolvedValueOnce({ status: WorkoutSessionStatus.COMPLETED, closeResult: null })
        .mockResolvedValue({ status: WorkoutSessionStatus.COMPLETED, closeResult: stored }),
    });

    const result = await service.finishSession(ownerId, tenantId, 'session-1');

    expect(result).toMatchObject({ progression: stored.progression, yaFinalizada: true });
  });

  it('stores what finish answered so a retry can repeat it', async () => {
    const saveCloseResult = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(session(WorkoutSessionStatus.IN_PROGRESS)),
      claimSessionClose: jest.fn().mockResolvedValue(true),
      saveCloseResult,
    });

    const result = await service.finishSession(ownerId, tenantId, 'session-1');

    expect(saveCloseResult).toHaveBeenCalledWith('session-1', { progression: null });
    expect(result).not.toHaveProperty('yaFinalizada');
  });

  it('runs the program hooks before computing the reward, so a goal bonus lands in this session', async () => {
    const order: string[] = [];
    const hooks = new SessionHooksRegistry();
    hooks.register('programs', () => {
      order.push('hook');
      return Promise.resolve({ programa: { semana: 1 } });
    });
    const service = new WorkoutsService(
      {
        findSessionByIdForUser: jest.fn().mockResolvedValue(session(WorkoutSessionStatus.IN_PROGRESS)),
        claimSessionClose: jest.fn().mockResolvedValue(true),
        saveCloseResult: jest.fn().mockResolvedValue(undefined),
      } as unknown as WorkoutsRepository,
      {} as ExercisesService,
      { findActiveBranchesWithCoordinates: jest.fn().mockResolvedValue([]) } as unknown as FacilitiesRepository,
      {} as Sequelize,
      {
        snapshot: jest.fn().mockResolvedValue({ points: 0 }),
        recordSessionReward: jest.fn().mockImplementation(() => {
          order.push('reward');
          return Promise.resolve({ pointsEarned: 350 });
        }),
      } as unknown as ProgressionService,
      hooks,
    );

    const result = await service.finishSession(ownerId, tenantId, 'session-1');

    expect(order).toEqual(['hook', 'reward']);
    expect(result).toMatchObject({ progression: { pointsEarned: 350 }, programa: { semana: 1 } });
  });

  it('still refuses to finish a cancelled session', async () => {
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(session(WorkoutSessionStatus.CANCELLED)),
    });

    await expect(service.finishSession(ownerId, tenantId, 'session-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('treats cancelling an already cancelled session as done', async () => {
    const changeSessionStatus = jest.fn();
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(session(WorkoutSessionStatus.CANCELLED)),
      changeSessionStatus,
    });

    const result = await service.cancelSession(ownerId, 'session-1');

    expect(changeSessionStatus).not.toHaveBeenCalled();
    expect(result.estado).toBe(WorkoutSessionStatus.CANCELLED);
  });
});

describe('WorkoutsService skipped sets and omitted exercises (D1)', () => {
  const sessionExerciseId = '00000000-0000-4000-8000-000000000010';

  function sessionExercise(overrides: Record<string, unknown> = {}) {
    return {
      id: sessionExerciseId,
      session: { userId: ownerId, status: WorkoutSessionStatus.IN_PROGRESS },
      sets: [],
      skippedSets: [],
      ...overrides,
    };
  }

  it('records a skipped set with its reason', async () => {
    const upsertSkippedSet = jest.fn().mockResolvedValue({
      id: 'skip-1',
      setNumber: 3,
      reason: 'CANSANCIO',
      note: null,
      recordedAt: new Date('2026-10-13T05:00:00Z'),
    });
    const service = createService({
      findSessionExerciseById: jest.fn().mockResolvedValue(sessionExercise()),
      upsertSkippedSet,
    });

    const result = await service.skipSet(ownerId, sessionExerciseId, {
      setNumber: 3,
      reason: 'CANSANCIO',
      note: null,
    });

    expect(upsertSkippedSet).toHaveBeenCalledWith(sessionExerciseId, {
      setNumber: 3,
      reason: 'CANSANCIO',
      note: null,
    });
    expect(result).toMatchObject({ id: 'skip-1', numeroSerie: 3, motivo: 'CANSANCIO', nota: null });
  });

  it('refuses to skip a set number that is already logged', async () => {
    const service = createService({
      findSessionExerciseById: jest
        .fn()
        .mockResolvedValue(sessionExercise({ sets: [{ id: 'set-9', setNumber: 3 }] })),
    });

    await expect(
      service.skipSet(ownerId, sessionExerciseId, { setNumber: 3, reason: 'PRISA', note: null }),
    ).rejects.toMatchObject({ code: 'SET_NUMBER_TAKEN', details: { setId: 'set-9' } });
  });

  it('does not let someone skip a set in another person session', async () => {
    const service = createService({
      findSessionExerciseById: jest.fn().mockResolvedValue(
        sessionExercise({ session: { userId: otherUserId, status: WorkoutSessionStatus.IN_PROGRESS } }),
      ),
    });

    await expect(
      service.skipSet(ownerId, sessionExerciseId, { setNumber: 1, reason: 'OTRO', note: null }),
    ).rejects.toThrow(NotFoundException);
  });

  it('undoes a skipped set only for its owner', async () => {
    const deleteSkippedSet = jest.fn().mockResolvedValue(1);
    const service = createService({
      findSkippedSetById: jest.fn().mockResolvedValue({
        id: 'skip-1',
        sessionExercise: { session: { userId: otherUserId, status: WorkoutSessionStatus.IN_PROGRESS } },
      }),
      deleteSkippedSet,
    });

    await expect(service.unskipSet(ownerId, 'skip-1')).rejects.toThrow(NotFoundException);
    expect(deleteSkippedSet).not.toHaveBeenCalled();
  });

  it('marks an exercise as omitted and gives it back whole', async () => {
    const setOmitted = jest.fn().mockResolvedValue(undefined);
    const omittedAt = new Date('2026-10-13T05:12:00Z');
    const service = createService({
      findSessionExerciseById: jest.fn().mockResolvedValue(sessionExercise()),
      setOmitted,
      findSessionExerciseWithExercise: jest.fn().mockResolvedValue({
        ...sessionExercise(),
        order: 2,
        isEmphasis: false,
        note: null,
        omittedReason: 'EQUIPO_OCUPADO',
        omittedNote: null,
        omittedAt,
      }),
    });

    const result = await service.setExerciseOmitted(ownerId, sessionExerciseId, {
      reason: 'EQUIPO_OCUPADO',
      note: null,
    });

    expect(setOmitted).toHaveBeenCalledWith(expect.anything(), { reason: 'EQUIPO_OCUPADO', note: null });
    expect(result.omitido).toEqual({ motivo: 'EQUIPO_OCUPADO', nota: null, fecha: omittedAt });
    expect(result.saltadas).toEqual([]);
  });
});

describe('WorkoutsService rest settings (D2)', () => {
  function inProgressSession(exercises: Array<Record<string, unknown>>): WorkoutSessionModel {
    return {
      id: 'session-1',
      userId: ownerId,
      status: WorkoutSessionStatus.IN_PROGRESS,
      sessionExercises: exercises,
    } as unknown as WorkoutSessionModel;
  }
  const transaction = {} as never;

  it('applies the rest to each listed exercise of the session', async () => {
    const updateSessionExerciseRest = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(
        inProgressSession([
          { id: 'a', group: null, durationSeconds: null },
          { id: 'b', group: 1, durationSeconds: null },
        ]),
      ),
      updateSessionExerciseRest,
    });

    const { touched } = await service.applyRestSettings(
      ownerId,
      'session-1',
      [
        { sessionExerciseId: 'a', restSeconds: 150 },
        { sessionExerciseId: 'b', restSeconds: 60, restBetweenSeconds: 15 },
      ],
      transaction,
    );

    expect(touched.map((item) => item.id)).toEqual(['a', 'b']);
    expect(updateSessionExerciseRest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'b' }),
      { restSeconds: 60, restBetweenSeconds: 15 },
      transaction,
    );
  });

  it('rejects a rest between exercises outside a superset', async () => {
    const service = createService({
      findSessionByIdForUser: jest
        .fn()
        .mockResolvedValue(inProgressSession([{ id: 'a', group: null, durationSeconds: null }])),
    });

    await expect(
      service.applyRestSettings(
        ownerId,
        'session-1',
        [{ sessionExerciseId: 'a', restBetweenSeconds: 15 }],
        transaction,
      ),
    ).rejects.toMatchObject({ code: 'REST_SETTING_INVALID', details: { campo: 'descansoEntreSeg' } });
  });

  it('rejects a work time on an exercise done by repetitions', async () => {
    const service = createService({
      findSessionByIdForUser: jest
        .fn()
        .mockResolvedValue(inProgressSession([{ id: 'a', group: null, durationSeconds: null }])),
    });

    await expect(
      service.applyRestSettings(
        ownerId,
        'session-1',
        [{ sessionExerciseId: 'a', durationSeconds: 45 }],
        transaction,
      ),
    ).rejects.toMatchObject({ code: 'REST_SETTING_INVALID', details: { campo: 'duracionSeg' } });
  });

  it('does not accept an exercise from another session', async () => {
    const service = createService({
      findSessionByIdForUser: jest
        .fn()
        .mockResolvedValue(inProgressSession([{ id: 'a', group: null, durationSeconds: null }])),
    });

    await expect(
      service.applyRestSettings(
        ownerId,
        'session-1',
        [{ sessionExerciseId: 'zzz', restSeconds: 30 }],
        transaction,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('WorkoutsService.addSet double tap', () => {
  const sessionExerciseId = '00000000-0000-4000-8000-000000000010';
  const input = {
    type: 'FUERZA' as const,
    setNumber: 2,
    repetitions: 8,
    weightKg: 60,
    rir: 2,
    durationSeconds: null,
    previousRestSeconds: 90,
  };

  function serviceWith(repository: Partial<WorkoutsRepository>): WorkoutsService {
    return new WorkoutsService(
      {
        findSessionExerciseById: jest.fn().mockResolvedValue({
          id: sessionExerciseId,
          durationSeconds: null,
          session: { userId: ownerId, status: WorkoutSessionStatus.IN_PROGRESS },
        }),
        ...repository,
      } as WorkoutsRepository,
      {} as ExercisesService,
      {} as FacilitiesRepository,
      { transaction: (run: (t: unknown) => unknown) => run({}) } as unknown as Sequelize,
      {} as ProgressionService,
      new SessionHooksRegistry(),
    );
  }

  function storedSet(createdAt: Date, weightKg = '60.00') {
    return {
      id: setId,
      setNumber: 2,
      type: 'FUERZA',
      repetitions: 8,
      weightKg,
      rir: 2,
      durationSeconds: null,
      previousRestSeconds: 90,
      recordedAt: createdAt,
      createdAt,
    } as unknown as WorkoutSetModel;
  }

  it('returns the set just logged when the same set arrives twice', async () => {
    const createSet = jest.fn();
    const service = serviceWith({
      findSetBySessionExerciseAndNumber: jest.fn().mockResolvedValue(storedSet(new Date())),
      createSet,
    });

    const result = await service.addSet(ownerId, sessionExerciseId, input);

    expect(createSet).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: setId, numeroSerie: 2, pesoKg: 60, repeticiones: 8 });
  });

  it('still reports a conflict when the repeated number carries different data', async () => {
    const service = serviceWith({
      findSetBySessionExerciseAndNumber: jest.fn().mockResolvedValue(storedSet(new Date(), '62.50')),
    });

    await expect(service.addSet(ownerId, sessionExerciseId, input)).rejects.toThrow(ConflictException);
  });

  it('still reports a conflict when the identical set is not recent', async () => {
    const service = serviceWith({
      findSetBySessionExerciseAndNumber: jest
        .fn()
        .mockResolvedValue(storedSet(new Date(Date.now() - 60_000))),
    });

    await expect(service.addSet(ownerId, sessionExerciseId, input)).rejects.toThrow(ConflictException);
  });

  it('clears the skipped mark of a set that ends up being done', async () => {
    const deleteSkippedSetByNumber = jest.fn().mockResolvedValue(1);
    const service = serviceWith({
      findSetBySessionExerciseAndNumber: jest.fn().mockResolvedValue(null),
      deleteSkippedSetByNumber,
      createSet: jest.fn().mockResolvedValue(storedSet(new Date())),
    });

    await service.addSet(ownerId, sessionExerciseId, input);

    expect(deleteSkippedSetByNumber).toHaveBeenCalledWith(sessionExerciseId, 2, expect.anything());
  });
});

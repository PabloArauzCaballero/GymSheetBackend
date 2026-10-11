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
    repositoryOverrides as WorkoutsRepository,
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
    const changeSessionStatus = jest
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
      changeSessionStatus,
    });

    await service.finishSession(ownerId, tenantId, 'session-1');

    expect(changeSessionStatus).toHaveBeenCalledWith(
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
        changeSessionStatus: jest.fn().mockImplementation((session: WorkoutSessionModel) => session),
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
    const changeSessionStatus = jest
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
        changeSessionStatus,
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

    expect(changeSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: true, verifiedBranchId: 'branch-1' },
    );
  });

  it('finishes without verification when the point falls outside every branch radius', async () => {
    const changeSessionStatus = jest
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
        changeSessionStatus,
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

    expect(changeSessionStatus).toHaveBeenCalledWith(
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

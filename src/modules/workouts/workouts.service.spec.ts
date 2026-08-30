import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { FacilitiesRepository } from '../facilities/facilities.repository';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const setId = '00000000-0000-4000-8000-000000000003';

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

    await service.finishSession(ownerId, 'session-1');

    expect(changeSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: false, verifiedBranchId: null },
    );
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

    await service.finishSession(ownerId, 'session-1', { latitude: 0.0001, longitude: 0 });

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

    await service.finishSession(ownerId, 'session-1', { latitude: 5, longitude: 5 });

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

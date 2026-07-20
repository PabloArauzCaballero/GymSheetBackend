import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutSetModel } from './workout-set.model';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const setId = '00000000-0000-4000-8000-000000000003';

function createService(repositoryOverrides: Partial<WorkoutsRepository>): WorkoutsService {
  return new WorkoutsService(
    repositoryOverrides as WorkoutsRepository,
    {} as ExercisesService,
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

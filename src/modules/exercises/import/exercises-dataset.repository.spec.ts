import { Transaction } from 'sequelize';
import { ExerciseMediaModel } from '../exercise-media.model';
import { ExerciseModel } from '../exercise.model';
import { ExercisesDatasetRepository } from './exercises-dataset.repository';
import { ExternalExercise } from './exercises-dataset.schemas';

const record: ExternalExercise = {
  id: '0001',
  name: 'Bench Press',
  category: 'strength',
  body_part: 'upper body',
  equipment: 'barbell',
  instructions: { en: 'Press the bar upward.' },
  instruction_steps: { en: ['Lie on the bench.', 'Press the bar upward.'] },
  muscle_group: 'chest',
  secondary_muscles: ['triceps'],
  target: 'pectoralis major',
  media_id: 'bench-press',
  image: 'images/0001.jpg',
  gif_url: 'videos/0001.gif',
  attribution: 'External dataset attribution',
  created_at: '2026-01-01T00:00:00.000Z',
};

const context = {
  sourceUrl: 'https://raw.githubusercontent.com/example/repository/main/data/exercises.json',
  sourceVersion: 'abc123',
  contentSha256: 'a'.repeat(64),
  fetchedAt: new Date('2026-01-02T00:00:00.000Z'),
  mediaBaseUrl: 'https://raw.githubusercontent.com/example/repository/main/',
  importMedia: false,
};

const transaction = {} as Transaction;

describe('ExercisesDatasetRepository', () => {
  it('creates a source record through findOrCreate without a check-then-insert race', async () => {
    const exercise = { id: 'exercise-1', update: jest.fn() } as unknown as ExerciseModel;
    const exerciseModel = {
      findOrCreate: jest.fn().mockResolvedValue([exercise, true]),
    } as unknown as typeof ExerciseModel;
    const repository = new ExercisesDatasetRepository(
      exerciseModel,
      {} as typeof ExerciseMediaModel,
    );

    await expect(repository.upsertExercise(record, context, transaction)).resolves.toMatchObject({
      exerciseId: 'exercise-1',
      created: true,
      mediaCreated: 0,
      mediaUpdated: 0,
    });
    expect(exerciseModel.findOrCreate).toHaveBeenCalledTimes(1);
    expect(exercise.update).not.toHaveBeenCalled();
  });

  it('updates the row returned by findOrCreate on repeated imports', async () => {
    const exercise = {
      id: 'exercise-1',
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as ExerciseModel;
    const exerciseModel = {
      findOrCreate: jest.fn().mockResolvedValue([exercise, false]),
    } as unknown as typeof ExerciseModel;
    const repository = new ExercisesDatasetRepository(
      exerciseModel,
      {} as typeof ExerciseMediaModel,
    );

    const result = await repository.upsertExercise(record, context, transaction);

    expect(result.created).toBe(false);
    expect(exercise.update).toHaveBeenCalledTimes(1);
  });
});

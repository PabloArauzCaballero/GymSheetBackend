import { bootstrapDatabase, startupSeedMode } from './database-bootstrap';
import { runMigrations } from './migrate';
import { runSeeds } from './seeders/seed';

jest.mock('./migrate', () => ({ runMigrations: jest.fn() }));
jest.mock('./seeders/seed', () => ({ runSeeds: jest.fn() }));

describe('database bootstrap', () => {
  const mockedRunMigrations = jest.mocked(runMigrations);
  const mockedRunSeeds = jest.mocked(runSeeds);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRunMigrations.mockResolvedValue();
    mockedRunSeeds.mockResolvedValue();
  });

  it('includes mock data only in development', () => {
    expect(startupSeedMode('development')).toBe('all');
    expect(startupSeedMode('test')).toBe('base');
    expect(startupSeedMode('production')).toBe('base');
  });

  it('finishes schema and migrations before running the environment seed', async () => {
    await bootstrapDatabase();

    expect(mockedRunMigrations).toHaveBeenCalledWith('up');
    expect(mockedRunSeeds).toHaveBeenCalledWith(startupSeedMode());
    expect(mockedRunMigrations.mock.invocationCallOrder[0]).toBeLessThan(
      mockedRunSeeds.mock.invocationCallOrder[0],
    );
  });

  it('does not seed a partially migrated database', async () => {
    mockedRunMigrations.mockRejectedValueOnce(new Error('migration failed'));

    await expect(bootstrapDatabase()).rejects.toThrow('migration failed');
    expect(mockedRunSeeds).not.toHaveBeenCalled();
  });
});

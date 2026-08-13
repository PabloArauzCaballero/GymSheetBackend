import { OutboxRetentionService } from './outbox-retention.service';

describe('OutboxRetentionService', () => {
  const buildService = () => {
    const repository = {
      countCompletedBefore: jest.fn(),
      deleteCompletedBefore: jest.fn(),
    };
    return {
      repository,
      service: new OutboxRetentionService(repository as never),
    };
  };

  it('dry-runs by default: counts candidates and deletes nothing', async () => {
    const { service, repository } = buildService();
    repository.countCompletedBefore.mockResolvedValue(42);

    const result = await service.prune({
      retentionDays: 30,
      batchSize: 1000,
      apply: false,
    });

    expect(result.candidates).toBe(42);
    expect(result.deleted).toBe(0);
    expect(repository.deleteCompletedBefore).not.toHaveBeenCalled();
  });

  it('computes the cutoff from the retention window', async () => {
    const { service, repository } = buildService();
    repository.countCompletedBefore.mockResolvedValue(0);
    const before = Date.now();

    const result = await service.prune({
      retentionDays: 10,
      batchSize: 1000,
      apply: false,
    });

    const expected = before - 10 * 24 * 60 * 60 * 1000;
    // Allow a small delta for execution time between reading `before` and now.
    expect(Math.abs(result.cutoff.getTime() - expected)).toBeLessThan(5000);
  });

  it('deletes in batches until a short batch drains the eligible set', async () => {
    const { service, repository } = buildService();
    repository.countCompletedBefore.mockResolvedValue(2500);
    repository.deleteCompletedBefore
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(500);

    const result = await service.prune({
      retentionDays: 30,
      batchSize: 1000,
      apply: true,
    });

    expect(result.deleted).toBe(2500);
    expect(repository.deleteCompletedBefore).toHaveBeenCalledTimes(3);
  });

  it('stops after a single empty batch when nothing is eligible', async () => {
    const { service, repository } = buildService();
    repository.countCompletedBefore.mockResolvedValue(0);
    repository.deleteCompletedBefore.mockResolvedValueOnce(0);

    const result = await service.prune({
      retentionDays: 30,
      batchSize: 1000,
      apply: true,
    });

    expect(result.deleted).toBe(0);
    expect(repository.deleteCompletedBefore).toHaveBeenCalledTimes(1);
  });
});

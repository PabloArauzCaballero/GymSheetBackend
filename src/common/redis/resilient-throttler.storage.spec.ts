import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { ResilientThrottlerStorage } from './resilient-throttler.storage';

const record: ThrottlerStorageRecord = {
  totalHits: 1,
  timeToExpire: 60,
  isBlocked: false,
  timeToBlockExpire: 0,
};

function createStorage(behaviour: 'ok' | 'fail'): ThrottlerStorage {
  return {
    increment:
      behaviour === 'ok'
        ? jest.fn().mockResolvedValue(record)
        : jest.fn().mockRejectedValue(new Error('redis connection refused')),
  };
}

const incrementArguments = ['key', 60000, 10, 0, 'default'] as const;

describe('ResilientThrottlerStorage', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the shared backend while it is healthy', async () => {
    const primary = createStorage('ok');
    const fallback = createStorage('ok');
    const storage = new ResilientThrottlerStorage(primary, fallback);

    await storage.increment(...incrementArguments);

    expect(primary.increment).toHaveBeenCalledTimes(1);
    expect(fallback.increment).not.toHaveBeenCalled();
  });

  it('keeps enforcing limits from the local backend when the shared one fails', async () => {
    // The guard runs before every handler, so a storage error must not become
    // an API-wide outage; the request continues under per-process counters.
    const primary = createStorage('fail');
    const fallback = createStorage('ok');
    const storage = new ResilientThrottlerStorage(primary, fallback);

    await expect(storage.increment(...incrementArguments)).resolves.toEqual(record);
    expect(fallback.increment).toHaveBeenCalledTimes(1);
  });

  it('does not fail open when the shared backend is unavailable', async () => {
    // Degrading must not mean skipping rate limiting: the fallback still counts.
    const fallback = createStorage('ok');
    const storage = new ResilientThrottlerStorage(createStorage('fail'), fallback);

    await storage.increment(...incrementArguments);

    expect(fallback.increment).toHaveBeenCalledWith(...incrementArguments);
  });

  it('logs the degradation at most once per minute during an outage', async () => {
    // A sustained outage produces one failure per request; without throttling
    // the log line, the outage itself becomes a second incident.
    const storage = new ResilientThrottlerStorage(createStorage('fail'), createStorage('ok'));
    const errorSpy = jest
      .spyOn((storage as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await storage.increment(...incrementArguments);
    await storage.increment(...incrementArguments);
    await storage.increment(...incrementArguments);

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates the record shape unchanged from whichever backend served it', async () => {
    const storage = new ResilientThrottlerStorage(createStorage('fail'), createStorage('ok'));

    await expect(storage.increment(...incrementArguments)).resolves.toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });
});

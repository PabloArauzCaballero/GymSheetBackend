import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/**
 * Rate-limit storage that survives a Redis outage.
 *
 * The throttler guard runs before every request handler, so an exception from
 * the storage backend turns a Redis outage into a total API outage. That trade
 * is wrong: rate limiting is a protective control, and losing the shared
 * counter must not take down the service it protects.
 *
 * On a backend failure this degrades to per-process counters, which is exactly
 * the behaviour of a deployment without Redis, and keeps serving. It does not
 * fail open: limits stay enforced, just no longer shared across instances.
 * The degradation is logged and surfaced through readiness, which reports the
 * instance as not ready so an operator sees it.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ResilientThrottlerStorage.name);
  private lastFailureLoggedAt = 0;

  constructor(
    private readonly primaryStorage: ThrottlerStorage,
    private readonly fallbackStorage: ThrottlerStorage,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.primaryStorage.increment(key, ttl, limit, blockDuration, throttlerName);
    } catch (error: unknown) {
      this.logDegradation(error);
      return this.fallbackStorage.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  /** Rate-limited to one entry per minute so an outage cannot flood the log. */
  private logDegradation(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLoggedAt < 60_000) return;
    this.lastFailureLoggedAt = now;

    this.logger.error({
      event: 'throttler.storage_degraded',
      detail: 'Shared rate-limit backend unavailable; using per-process counters.',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

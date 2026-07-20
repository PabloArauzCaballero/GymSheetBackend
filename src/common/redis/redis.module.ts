import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Injectable Redis handle. `null` when `REDIS_URL` is not configured, so
 * consumers must treat shared state as unavailable rather than assume a client.
 */
export type OptionalRedisClient = Redis | null;

export function createRedisClient(): OptionalRedisClient {
  if (!env.REDIS_URL) {
    return null;
  }

  const client = new Redis(env.REDIS_URL, {
    connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    // Retries are bounded and the offline queue is disabled: an unreachable
    // Redis must surface as a failed command the caller handles, never as an
    // unbounded backlog of pending requests holding memory.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (attemptCount) => Math.min(attemptCount * 200, 5000),
  });

  client.on('error', (error: Error) => {
    // ioredis emits on every reconnect attempt. Logged without a stack to avoid
    // flooding, and never with the URL, which may carry credentials.
    Logger.warn(
      { event: 'redis.connection_error', errorName: error.name, errorMessage: error.message },
      'RedisModule',
    );
  });

  return client;
}

@Global()
@Module({
  providers: [{ provide: REDIS_CLIENT, useFactory: createRedisClient }],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: OptionalRedisClient) {}

  /**
   * Closes the connection on shutdown so a restarting instance does not leave
   * a socket held on the Redis server until it times out.
   */
  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.quit();
    } catch {
      // `quit` fails when the link is already broken; drop the socket outright.
      this.client.disconnect();
    }
  }
}

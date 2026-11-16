import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { OptionalRedisClient, REDIS_CLIENT } from "../../common/redis/redis.module";
import { ANTIBOT_CLOCK, ANTIBOT_CONFIG, AntibotClock, AntibotConfig } from "./antibot.config";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MEMORY_MAX_KEYS = 20_000;

export type RateLimitInput = { ip: string | null; installationId: string | null; emailDomain: string };
export type RateLimitResult = { exceeded: boolean; ipCount: number };

/**
 * Layer 5: fixed-window signup velocity per IP, installation and email domain.
 *
 * Same storage policy as the global throttler: Redis when configured, so the
 * limits hold across instances; per-process counters otherwise, and also as
 * the fallback when Redis fails, so an outage never blocks every signup.
 * Keys are HMACs, never the raw IP or domain.
 */
@Injectable()
export class SignupRateLimiter {
  private readonly logger = new Logger(SignupRateLimiter.name);
  private readonly memory = new Map<string, { count: number; resetAt: number }>();
  private lastDegradationLog = 0;

  constructor(
    @Inject(ANTIBOT_CONFIG) private readonly config: AntibotConfig,
    @Inject(ANTIBOT_CLOCK) private readonly clock: AntibotClock,
    @Inject(REDIS_CLIENT) private readonly redis: OptionalRedisClient,
  ) {}

  async hit(input: RateLimitInput): Promise<RateLimitResult> {
    let exceeded = false;
    let ipCount = 0;
    if (input.ip) {
      ipCount = await this.increment("ip", input.ip, HOUR_MS);
      exceeded ||= ipCount > this.config.limitPerIpHour;
    }
    if (input.installationId) {
      const count = await this.increment("inst", input.installationId, DAY_MS);
      exceeded ||= count > this.config.limitPerInstallationDay;
    }
    if (!this.config.emailDomainAllowlist.includes(input.emailDomain)) {
      const count = await this.increment("dom", input.emailDomain, HOUR_MS);
      exceeded ||= count > this.config.limitPerEmailDomainHour;
    }
    return { exceeded, ipCount };
  }

  private async increment(scope: string, value: string, windowMs: number): Promise<number> {
    const digest = createHmac("sha256", this.config.ticketSecret).update(value).digest("hex").slice(0, 32);
    const key = `signup:rl:${scope}:${digest}`;
    if (this.redis) {
      try {
        const results = await this.redis.multi().set(key, "0", "PX", windowMs, "NX").incr(key).exec();
        const count = results?.[1]?.[1];
        if (typeof count === "number") return count;
        throw new Error("Unexpected Redis MULTI result");
      } catch (error: unknown) {
        this.logDegradation(error);
      }
    }
    return this.incrementInMemory(key, windowMs);
  }

  private incrementInMemory(key: string, windowMs: number): number {
    const now = this.clock().getTime();
    const current = this.memory.get(key);
    if (current && current.resetAt > now) {
      current.count += 1;
      return current.count;
    }
    if (this.memory.size >= MEMORY_MAX_KEYS) this.evictExpired(now);
    this.memory.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }

  /** Bounded memory: drop expired windows, and if that is not enough, the oldest keys. */
  private evictExpired(now: number): void {
    for (const [key, entry] of this.memory) if (entry.resetAt <= now) this.memory.delete(key);
    const overflow = this.memory.size - MEMORY_MAX_KEYS + 1;
    if (overflow <= 0) return;
    let dropped = 0;
    for (const key of this.memory.keys()) {
      if (dropped++ >= overflow) break;
      this.memory.delete(key);
    }
  }

  private logDegradation(error: unknown): void {
    const now = Date.now();
    if (now - this.lastDegradationLog < 60_000) return;
    this.lastDegradationLog = now;
    this.logger.error({
      event: "antibot.rate_limit_storage_degraded",
      detail: "Redis unavailable; signup limits use per-process counters.",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

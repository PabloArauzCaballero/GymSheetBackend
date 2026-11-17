import { Injectable, Logger } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";

/** Minimum gap between two activity writes for the same account. */
export const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60_000;

/**
 * Records app activity for the discovery ranking: `last_active_at` and the
 * per-hour "last active date" histogram (`active_hours[h + 1]`, business time
 * zone). The authenticated request already loaded `last_active_at`, so a fresh
 * value costs nothing; a stale one costs one primary-key UPDATE whose WHERE
 * clause also absorbs concurrent requests of the same account.
 */
@Injectable()
export class UserActivityService {
  private readonly logger = new Logger(UserActivityService.name);

  constructor(private readonly sequelize: Sequelize) {}

  /** Fire-and-forget: activity is a ranking signal, never a reason to fail a request. */
  recordIfStale(userId: string, lastActiveAt: Date | null | undefined, now = Date.now()): void {
    if (lastActiveAt && now - lastActiveAt.getTime() < ACTIVITY_WRITE_INTERVAL_MS) return;
    this.touch(userId).catch((error: unknown) => {
      this.logger.warn({
        event: "user.activity.write_failed",
        reason: error instanceof Error ? error.name : "unknown",
      });
    });
  }

  async touch(userId: string): Promise<void> {
    await this.sequelize.query(
      `UPDATE public.usuarios u
          SET last_active_at = now(),
              active_hours = ARRAY(
                SELECT CASE WHEN slot = EXTRACT(HOUR FROM now() AT TIME ZONE :timeZone)::int + 1
                            THEN (now() AT TIME ZONE :timeZone)::date
                            ELSE u.active_hours[slot] END
                  FROM generate_series(1, 24) AS slot ORDER BY slot)
        WHERE u.id = :userId
          AND (u.last_active_at IS NULL OR u.last_active_at < now() - INTERVAL '5 minutes')`,
      {
        type: QueryTypes.UPDATE,
        replacements: { userId, timeZone: env.BUSINESS_TIME_ZONE },
      },
    );
  }
}

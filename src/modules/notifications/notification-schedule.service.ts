import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';

const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

@Injectable()
export class NotificationScheduleService {
  nextAllowedAt(
    now: Date,
    quietHoursStart: string | null,
    quietHoursEnd: string | null,
  ): Date {
    if (!quietHoursStart || !quietHoursEnd) return now;

    const currentSeconds = this.localSeconds(now);
    const startSeconds = this.parseTime(quietHoursStart);
    const endSeconds = this.parseTime(quietHoursEnd);
    const delaySeconds = this.delayUntilAllowed(
      currentSeconds,
      startSeconds,
      endSeconds,
    );

    return delaySeconds === 0
      ? now
      : new Date(now.getTime() + (delaySeconds + 1) * 1000);
  }

  private delayUntilAllowed(
    currentSeconds: number,
    startSeconds: number,
    endSeconds: number,
  ): number {
    if (startSeconds === endSeconds) return 0;

    if (startSeconds < endSeconds) {
      return currentSeconds >= startSeconds && currentSeconds < endSeconds
        ? endSeconds - currentSeconds
        : 0;
    }

    if (currentSeconds >= startSeconds) {
      return 86_400 - currentSeconds + endSeconds;
    }

    return currentSeconds < endSeconds ? endSeconds - currentSeconds : 0;
  }

  private localSeconds(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: env.BUSINESS_TIME_ZONE,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return (
      Number(values.hour) * 3600 +
      Number(values.minute) * 60 +
      Number(values.second)
    );
  }

  private parseTime(value: string): number {
    const match = TIME_PATTERN.exec(value);
    if (!match) throw new Error(`Invalid quiet-hours value: ${value}`);
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
  }
}

import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class BusinessDateService {
  today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: env.BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  addDays(dateOnly: string, days: number): string {
    const date = this.toUtcDate(dateOnly);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  daysBetween(fromDateOnly: string, toDateOnly: string): number {
    const milliseconds = this.toUtcDate(toDateOnly).getTime() - this.toUtcDate(fromDateOnly).getTime();
    return Math.trunc(milliseconds / 86_400_000);
  }

  isWithin(dateOnly: string, startsOn: string, endsOn: string): boolean {
    return dateOnly >= startsOn && dateOnly <= endsOn;
  }

  private toUtcDate(dateOnly: string): Date {
    if (!DATE_ONLY_PATTERN.test(dateOnly)) {
      throw new Error(`Invalid date-only value: ${dateOnly}`);
    }
    const [year, month, day] = dateOnly.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.toISOString().slice(0, 10) !== dateOnly) {
      throw new Error(`Invalid calendar date: ${dateOnly}`);
    }
    return date;
  }
}

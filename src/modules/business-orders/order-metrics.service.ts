import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env';

/**
 * Prometheus block of the orders waiting for a business's decision (plan
 * §2.9), read live on each scrape of `/health/metrics`: how many, how many are
 * past the second reminder, and the age of the oldest. Zeros are rendered so
 * an alert needs no `absent()`.
 */
@Injectable()
export class OrderMetricsService {
  constructor(private readonly sequelize: Sequelize) {}

  async renderPrometheus(): Promise<string> {
    const [row] = await this.sequelize.query<{ undecided: number; overdue: number; oldest: number | null }>(
      `SELECT count(*)::int AS undecided,
              count(*) FILTER (WHERE submitted_at <= now() - make_interval(hours => :second))::int AS overdue,
              extract(epoch FROM now() - min(submitted_at))::float AS oldest
         FROM directory.payment_orders WHERE status = 'PENDING_VERIFICATION' AND method = 'QR'`,
      { type: QueryTypes.SELECT, replacements: { second: env.ORDER_VERIFICATION_SECOND_REMINDER_HOURS } },
    );
    const lines = [
      '# HELP gym_sheet_orders_undecided QR orders with a receipt waiting for the business to confirm or reject.',
      '# TYPE gym_sheet_orders_undecided gauge',
      `gym_sheet_orders_undecided ${row?.undecided ?? 0}`,
      '# HELP gym_sheet_orders_undecided_overdue Undecided orders past the second verification reminder.',
      '# TYPE gym_sheet_orders_undecided_overdue gauge',
      `gym_sheet_orders_undecided_overdue ${row?.overdue ?? 0}`,
      '# HELP gym_sheet_orders_undecided_oldest_seconds Age of the oldest undecided receipt (0 without any).',
      '# TYPE gym_sheet_orders_undecided_oldest_seconds gauge',
      `gym_sheet_orders_undecided_oldest_seconds ${Number(row?.oldest ?? 0).toFixed(0)}`,
    ];
    return `${lines.join('\n')}\n`;
  }
}

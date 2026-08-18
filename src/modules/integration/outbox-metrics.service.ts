import { Injectable } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';

/**
 * Renders a Prometheus block describing outbox queue health: how many jobs sit
 * in each actionable state per queue, and how long the oldest due job has
 * waited. Exposed through GET /health/metrics alongside the HTTP metrics.
 *
 * The API process serves this endpoint while workers run as separate processes,
 * so the database is the only cross-process source of truth for queue depth;
 * these figures are read live from `integration.outbox_jobs` on each scrape.
 */
@Injectable()
export class OutboxMetricsService {
  constructor(private readonly repository: OutboxRepository) {}

  async renderPrometheus(): Promise<string> {
    const snapshot = await this.repository.aggregateQueueMetrics();

    const lines = [
      '# HELP gym_sheet_outbox_jobs Outbox jobs in actionable states by queue and status.',
      '# TYPE gym_sheet_outbox_jobs gauge',
    ];

    for (const row of [...snapshot.depth].sort((left, right) =>
      `${left.queueName}|${left.status}`.localeCompare(
        `${right.queueName}|${right.status}`,
      ),
    )) {
      const labels = `queue="${this.escapeLabel(row.queueName)}",status="${this.escapeLabel(row.status)}"`;
      lines.push(`gym_sheet_outbox_jobs{${labels}} ${row.count}`);
    }

    lines.push(
      '# HELP gym_sheet_outbox_backlog_age_seconds Age of the oldest due (PENDING/FAILED) job per queue.',
      '# TYPE gym_sheet_outbox_backlog_age_seconds gauge',
    );

    for (const row of [...snapshot.backlogAge].sort((left, right) =>
      left.queueName.localeCompare(right.queueName),
    )) {
      const labels = `queue="${this.escapeLabel(row.queueName)}"`;
      lines.push(
        `gym_sheet_outbox_backlog_age_seconds{${labels}} ${Math.max(0, row.ageSeconds).toFixed(3)}`,
      );
    }

    return `${lines.join('\n')}\n`;
  }

  private escapeLabel(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/"/g, '\\"');
  }
}

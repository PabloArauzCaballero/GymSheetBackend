import { Injectable } from '@nestjs/common';
import { QueueItemStatus } from '../../common/enums/domain.enums';
import { OutboxRepository } from './outbox.repository';

/**
 * Queues whose dead letters are always rendered, zero included, so an alert on
 * them needs no `absent()` trick: a dead-lettered `media.release` job is a
 * file of a person that was not erased (ADR-0017, runbook).
 */
const WATCHED_DEAD_LETTER_QUEUES = ['media.release'] as const;

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
      '# HELP gym_sheet_outbox_dead_letter_jobs Dead-lettered outbox jobs of the queues that need a person (always rendered, 0 included).',
      '# TYPE gym_sheet_outbox_dead_letter_jobs gauge',
    );
    for (const queueName of WATCHED_DEAD_LETTER_QUEUES) {
      const deadLetters = snapshot.depth.find(
        (row) => row.queueName === queueName && row.status === QueueItemStatus.DEAD_LETTER,
      );
      lines.push(`gym_sheet_outbox_dead_letter_jobs{queue="${queueName}"} ${deadLetters?.count ?? 0}`);
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

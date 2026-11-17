import { QueueItemStatus } from '../../common/enums/domain.enums';
import { MEDIA_RELEASE_QUEUE } from '../media/media-release.service';
import { OutboxMetricsService } from './outbox-metrics.service';
import { QueueMetricsSnapshot } from './outbox.repository';

describe('OutboxMetricsService', () => {
  const buildService = (snapshot: QueueMetricsSnapshot) => {
    const repository = {
      aggregateQueueMetrics: jest.fn().mockResolvedValue(snapshot),
    };
    return {
      service: new OutboxMetricsService(repository as never),
      repository,
    };
  };

  it('renders depth and backlog gauges with HELP/TYPE headers', async () => {
    const { service } = buildService({
      depth: [
        {
          queueName: 'notifications.delivery',
          status: QueueItemStatus.PENDING,
          count: 3,
        },
        {
          queueName: 'notifications.delivery',
          status: QueueItemStatus.DEAD_LETTER,
          count: 1,
        },
      ],
      backlogAge: [
        { queueName: 'notifications.delivery', ageSeconds: 12.3456 },
      ],
    });

    const output = await service.renderPrometheus();

    expect(output).toContain('# TYPE gym_sheet_outbox_jobs gauge');
    expect(output).toContain(
      'gym_sheet_outbox_jobs{queue="notifications.delivery",status="PENDING"} 3',
    );
    expect(output).toContain(
      'gym_sheet_outbox_jobs{queue="notifications.delivery",status="DEAD_LETTER"} 1',
    );
    expect(output).toContain(
      '# TYPE gym_sheet_outbox_backlog_age_seconds gauge',
    );
    expect(output).toContain(
      'gym_sheet_outbox_backlog_age_seconds{queue="notifications.delivery"} 12.346',
    );
    expect(output.endsWith('\n')).toBe(true);
  });

  it('emits stable headers even with no jobs in flight', async () => {
    const { service } = buildService({ depth: [], backlogAge: [] });

    const output = await service.renderPrometheus();

    expect(output).toContain('# HELP gym_sheet_outbox_jobs');
    expect(output).toContain('# HELP gym_sheet_outbox_backlog_age_seconds');
    expect(output).not.toContain('gym_sheet_outbox_jobs{');
  });

  it('clamps a negative age (clock skew) to zero', async () => {
    const { service } = buildService({
      depth: [],
      backlogAge: [{ queueName: 'access.decisions', ageSeconds: -0.5 }],
    });

    const output = await service.renderPrometheus();

    expect(output).toContain(
      'gym_sheet_outbox_backlog_age_seconds{queue="access.decisions"} 0.000',
    );
  });

  it('escapes label characters that would break the exposition format', async () => {
    const { service } = buildService({
      depth: [
        {
          queueName: 'weird"queue',
          status: QueueItemStatus.PENDING,
          count: 1,
        },
      ],
      backlogAge: [],
    });

    const output = await service.renderPrometheus();

    expect(output).toContain('queue="weird\\"queue"');
  });
  it('always renders the media.release dead letters, zero included (ADR-0017 runbook)', async () => {
    const empty = await buildService({ depth: [], backlogAge: [] }).service.renderPrometheus();
    expect(empty).toContain('# TYPE gym_sheet_outbox_dead_letter_jobs gauge');
    expect(empty).toContain(`gym_sheet_outbox_dead_letter_jobs{queue="${MEDIA_RELEASE_QUEUE}"} 0`);

    const stuck = await buildService({
      depth: [
        { queueName: MEDIA_RELEASE_QUEUE, status: QueueItemStatus.DEAD_LETTER, count: 4 },
        { queueName: MEDIA_RELEASE_QUEUE, status: QueueItemStatus.FAILED, count: 9 },
        { queueName: 'notifications.delivery', status: QueueItemStatus.DEAD_LETTER, count: 2 },
      ],
      backlogAge: [],
    }).service.renderPrometheus();
    expect(stuck).toContain(`gym_sheet_outbox_dead_letter_jobs{queue="${MEDIA_RELEASE_QUEUE}"} 4`);
    expect(stuck).not.toContain('gym_sheet_outbox_dead_letter_jobs{queue="notifications.delivery"}');
  });
});

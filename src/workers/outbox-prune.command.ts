import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { env } from '../config/env';
import { OutboxRetentionService } from '../modules/integration/outbox-retention.service';
import { OutboxMaintenanceModule } from './outbox-maintenance.module';

/**
 * Outbox retention maintenance. Runs as a one-shot command, not a long-lived
 * worker, so an operator or an external scheduler decides when it executes.
 *
 * Safe by default: without `--apply` it only reports how many COMPLETED jobs are
 * eligible (dry run). Pass `--apply` to actually delete them in bounded batches.
 * It never touches PENDING, PROCESSING, FAILED or DEAD_LETTER jobs.
 *
 *   yarn db:outbox:prune           # dry run
 *   yarn db:outbox:prune --apply   # delete eligible COMPLETED jobs
 */
async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const application = await NestFactory.createApplicationContext(
    OutboxMaintenanceModule,
    { logger: ['error', 'warn', 'log'] },
  );

  try {
    const result = await application.get(OutboxRetentionService).prune({
      retentionDays: env.OUTBOX_RETENTION_DAYS,
      batchSize: env.OUTBOX_PRUNE_BATCH_SIZE,
      apply,
    });

    Logger.log(
      {
        event: apply ? 'outbox.prune.completed' : 'outbox.prune.dry_run',
        retentionDays: env.OUTBOX_RETENTION_DAYS,
        cutoff: result.cutoff.toISOString(),
        candidates: result.candidates,
        deleted: result.deleted,
      },
      'OutboxPrune',
    );
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  Logger.error(
    {
      event: 'outbox.prune.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
    'OutboxPrune',
  );
  process.exitCode = 1;
});

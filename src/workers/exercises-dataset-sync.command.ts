import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { ExercisesDatasetService } from '../modules/exercises/import/exercises-dataset.service';
import { ExercisesDatasetWorkerModule } from './exercises-dataset-worker.module';

async function run() {
  const startedAt = Date.now();
  const correlationId = randomUUID();
  const application = await NestFactory.createApplicationContext(ExercisesDatasetWorkerModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await application.get(ExercisesDatasetService).importDataset({ dryRun: false, importMedia: false });
    process.stdout.write(`${JSON.stringify({ event: 'workoutkata.sync.completed', correlationId, sourceUrl: result.sourceUrl, recordsRead: result.totalRecords, recordsValid: result.totalRecords, recordsInserted: result.createdExercises, recordsUpdated: result.updatedExercises, recordsSkipped: result.unchangedSnapshot ? result.totalRecords : 0, recordsRejected: 0, errors: 0, durationMilliseconds: Date.now() - startedAt, contentSha256: result.contentSha256 })}\n`);
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ event: 'workoutkata.sync.failed', errorName: error instanceof Error ? error.name : 'UnknownError', errorMessage: error instanceof Error ? error.message : 'Unknown error' })}\n`);
  process.exitCode = 1;
});

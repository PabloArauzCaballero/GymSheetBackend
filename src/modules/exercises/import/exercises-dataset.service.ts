import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../../config/env';
import { ExercisesDatasetClient } from './exercises-dataset.client';
import { ExercisesDatasetRepository } from './exercises-dataset.repository';
import { ExerciseDatasetImportOptions } from './exercises-dataset.schemas';

export type ExercisesDatasetImportResult = {
  dryRun: boolean;
  sourceUrl: string;
  sourceVersion: string;
  contentSha256: string;
  fetchedAt: Date;
  totalRecords: number;
  createdExercises: number;
  updatedExercises: number;
  createdMedia: number;
  updatedMedia: number;
  mediaImported: boolean;
  batchesProcessed: number;
};

@Injectable()
export class ExercisesDatasetService {
  private readonly logger = new Logger(ExercisesDatasetService.name);

  constructor(
    private readonly client: ExercisesDatasetClient,
    private readonly repository: ExercisesDatasetRepository,
    private readonly sequelize: Sequelize,
  ) {}

  /**
   * Imports a validated snapshot in bounded transactional batches.
   *
   * Records are keyed by `(dataSource, externalId)`, making retries and repeated
   * imports idempotent. Custom exercises remain separate and can be created
   * through the regular exercise endpoints.
   */
  async importDataset(
    options: ExerciseDatasetImportOptions,
  ): Promise<ExercisesDatasetImportResult> {
    if (!env.EXERCISES_DATASET_ENABLED) {
      throw new ServiceUnavailableException(
        'Exercises dataset connector is disabled by configuration.',
      );
    }

    const importMedia = options.importMedia ?? env.EXERCISES_DATASET_IMPORT_MEDIA;

    if (importMedia && !env.EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED) {
      throw new ForbiddenException(
        'Media import requires explicit confirmation of the external media license.',
      );
    }

    const snapshot = await this.client.fetchSnapshot();
    const baseResult: ExercisesDatasetImportResult = {
      dryRun: options.dryRun,
      sourceUrl: snapshot.sourceUrl,
      sourceVersion: snapshot.sourceVersion,
      contentSha256: snapshot.contentSha256,
      fetchedAt: snapshot.fetchedAt,
      totalRecords: snapshot.records.length,
      createdExercises: 0,
      updatedExercises: 0,
      createdMedia: 0,
      updatedMedia: 0,
      mediaImported: importMedia,
      batchesProcessed: 0,
    };

    if (options.dryRun) {
      return baseResult;
    }

    const mediaBaseUrl = this.resolveMediaBaseUrl(snapshot.sourceUrl);

    for (
      let batchStart = 0;
      batchStart < snapshot.records.length;
      batchStart += env.EXERCISES_DATASET_BATCH_SIZE
    ) {
      const batch = snapshot.records.slice(
        batchStart,
        batchStart + env.EXERCISES_DATASET_BATCH_SIZE,
      );
      const batchResult = await this.sequelize.transaction(async (transaction) => {
        const counters = {
          createdExercises: 0,
          updatedExercises: 0,
          createdMedia: 0,
          updatedMedia: 0,
        };

        for (const record of batch) {
          const importResult = await this.repository.upsertExercise(
            record,
            {
              sourceUrl: snapshot.sourceUrl,
              sourceVersion: snapshot.sourceVersion,
              contentSha256: snapshot.contentSha256,
              fetchedAt: snapshot.fetchedAt,
              mediaBaseUrl,
              importMedia,
            },
            transaction,
          );

          if (importResult.created) {
            counters.createdExercises += 1;
          } else {
            counters.updatedExercises += 1;
          }
          counters.createdMedia += importResult.mediaCreated;
          counters.updatedMedia += importResult.mediaUpdated;
        }

        return counters;
      });

      baseResult.createdExercises += batchResult.createdExercises;
      baseResult.updatedExercises += batchResult.updatedExercises;
      baseResult.createdMedia += batchResult.createdMedia;
      baseResult.updatedMedia += batchResult.updatedMedia;
      baseResult.batchesProcessed += 1;

      this.logger.log({
        event: 'exercises_dataset.batch_imported',
        sourceVersion: snapshot.sourceVersion,
        batchNumber: baseResult.batchesProcessed,
        recordsProcessed: Math.min(
          batchStart + batch.length,
          snapshot.records.length,
        ),
        totalRecords: snapshot.records.length,
      });
    }

    return baseResult;
  }

  private resolveMediaBaseUrl(sourceUrl: string): string {
    const parsedSourceUrl = new URL(sourceUrl);
    return new URL('../', parsedSourceUrl).toString();
  }
}

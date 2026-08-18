import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Sequelize } from "sequelize-typescript";
import { QueryTypes } from "sequelize";
import { env } from "../../../config/env";
import { ExercisesDatasetClient } from "./exercises-dataset.client";
import { ExercisesDatasetRepository } from "./exercises-dataset.repository";
import { ExerciseDatasetImportOptions } from "./exercises-dataset.schemas";

export type ExercisesDatasetImportResult = {
  dryRun: boolean;
  unchangedSnapshot: boolean;
  sourceUrl: string;
  sourceVersion: string;
  contentSha256: string;
  fetchedAt: Date;
  totalRecords: number;
  createdExercises: number;
  updatedExercises: number;
  createdMedia: number;
  updatedMedia: number;
  deactivatedExercises: number;
  mediaImported: boolean;
  openMediaMatched: number;
  batchesProcessed: number;
};

const DATASET_SOURCE_KEY = "hasaneyldrm/exercises-dataset";

type ExercisesDatasetSyncState = {
  contentSha256: string;
  recordCount: number;
  refreshedAt: Date;
};

@Injectable()
export class ExercisesDatasetService {
  private readonly logger = new Logger(ExercisesDatasetService.name);

  constructor(
    private readonly client: ExercisesDatasetClient,
    private readonly repository: ExercisesDatasetRepository,
    private readonly sequelize: Sequelize,
  ) {}

  async latestSuccessfulRefreshAt(): Promise<Date | null> {
    return (await this.successfulSyncState())?.refreshedAt ?? null;
  }

  private async successfulSyncState(): Promise<ExercisesDatasetSyncState | null> {
    const rows = await this.sequelize.query<{
      contentSha256: string;
      recordCount: number | string;
      refreshedAt: Date | string;
    }>(
      `SELECT content_sha256 AS "contentSha256",
              record_count AS "recordCount",
              refreshed_at AS "refreshedAt"
         FROM integration.exercise_dataset_sync_state
        WHERE source_key = :sourceKey`,
      {
        replacements: { sourceKey: DATASET_SOURCE_KEY },
        type: QueryTypes.SELECT,
      },
    );
    const row = rows[0];
    if (!row) return null;
    const refreshedAt =
      row.refreshedAt instanceof Date
        ? row.refreshedAt
        : new Date(row.refreshedAt);
    const recordCount = Number(row.recordCount);
    if (
      Number.isNaN(refreshedAt.getTime()) ||
      !Number.isSafeInteger(recordCount) ||
      recordCount < 0
    ) {
      return null;
    }
    return { contentSha256: row.contentSha256, recordCount, refreshedAt };
  }

  async getRefreshStatus() {
    const lastSuccessfulRefreshAt = await this.latestSuccessfulRefreshAt();
    const nextRefreshAt = lastSuccessfulRefreshAt
      ? new Date(
          lastSuccessfulRefreshAt.getTime() +
            env.EXERCISES_DATASET_REFRESH_INTERVAL_MS,
        )
      : null;
    return {
      enabled: env.EXERCISES_DATASET_ENABLED,
      sourceUrl: env.EXERCISES_DATASET_JSON_URL,
      cache: "postgresql",
      refreshIntervalMilliseconds: env.EXERCISES_DATASET_REFRESH_INTERVAL_MS,
      retryIntervalMilliseconds: env.EXERCISES_DATASET_REFRESH_RETRY_MS,
      minimumSafeRecordCount: env.EXERCISES_DATASET_MIN_RECORDS,
      lastSuccessfulRefreshAt,
      nextRefreshAt,
      stale: !lastSuccessfulRefreshAt || Date.now() >= nextRefreshAt!.getTime(),
    };
  }

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
        "Exercises dataset connector is disabled by configuration.",
      );
    }

    const importMedia =
      options.importMedia ?? env.EXERCISES_DATASET_IMPORT_MEDIA;

    if (importMedia && !env.EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED) {
      throw new ForbiddenException(
        "Media import requires explicit confirmation of the external media license.",
      );
    }

    const snapshot = await this.client.fetchSnapshot();
    if (snapshot.records.length < env.EXERCISES_DATASET_MIN_RECORDS) {
      throw new ServiceUnavailableException(
        `Exercises dataset contains ${snapshot.records.length} records; minimum safe count is ${env.EXERCISES_DATASET_MIN_RECORDS}.`,
      );
    }
    const baseResult: ExercisesDatasetImportResult = {
      dryRun: options.dryRun,
      unchangedSnapshot: false,
      sourceUrl: snapshot.sourceUrl,
      sourceVersion: snapshot.sourceVersion,
      contentSha256: snapshot.contentSha256,
      fetchedAt: snapshot.fetchedAt,
      totalRecords: snapshot.records.length,
      createdExercises: 0,
      updatedExercises: 0,
      createdMedia: 0,
      updatedMedia: 0,
      deactivatedExercises: 0,
      mediaImported: importMedia,
      openMediaMatched: 0,
      batchesProcessed: 0,
    };

    if (options.dryRun) {
      return baseResult;
    }

    if (env.EXERCISES_OPEN_MEDIA_ENABLED) {
      try {
        const records = await this.client.fetchOpenMediaCatalog?.();
        if (records?.length) {
          const mediaResult = await this.sequelize.transaction((transaction) =>
            this.repository.upsertOpenMedia(
              records,
              this.resolveOpenMediaBaseUrl(),
              transaction,
            ),
          );
          baseResult.createdMedia += mediaResult.created;
          baseResult.updatedMedia += mediaResult.updated;
          baseResult.openMediaMatched = mediaResult.matched;
          baseResult.mediaImported = mediaResult.matched > 0 || importMedia;
          this.logger.log({
            event: "exercises_dataset.open_media_enriched",
            source: "yuhonas/free-exercise-db",
            ...mediaResult,
          });
        }
      } catch (error: unknown) {
        this.logger.warn({
          event: "exercises_dataset.open_media_unavailable",
          detail:
            "Exercise data refresh continues with the existing media cache.",
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const previousState = await this.successfulSyncState();
    const unchangedSnapshot =
      !importMedia &&
      previousState?.contentSha256 === snapshot.contentSha256 &&
      previousState.recordCount === snapshot.records.length;

    if (unchangedSnapshot) {
      await this.writeSuccessfulCheckpoint(snapshot);
      baseResult.unchangedSnapshot = true;
      this.logger.log({
        event: "exercises_dataset.snapshot_unchanged",
        sourceVersion: snapshot.sourceVersion,
        contentSha256: snapshot.contentSha256,
        totalRecords: snapshot.records.length,
      });
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
      const batchResult = await this.sequelize.transaction(
        async (transaction) => {
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
        },
      );

      baseResult.createdExercises += batchResult.createdExercises;
      baseResult.updatedExercises += batchResult.updatedExercises;
      baseResult.createdMedia += batchResult.createdMedia;
      baseResult.updatedMedia += batchResult.updatedMedia;
      baseResult.batchesProcessed += 1;

      this.logger.log({
        event: "exercises_dataset.batch_imported",
        sourceVersion: snapshot.sourceVersion,
        batchNumber: baseResult.batchesProcessed,
        recordsProcessed: Math.min(
          batchStart + batch.length,
          snapshot.records.length,
        ),
        totalRecords: snapshot.records.length,
      });
    }

    await this.sequelize.transaction(async (transaction) => {
      baseResult.deactivatedExercises =
        await this.repository.deactivateMissingExercises(
          snapshot.records.map((record) => record.id),
          transaction,
        );
      await this.writeSuccessfulCheckpoint(snapshot, transaction);
    });

    return baseResult;
  }

  private async writeSuccessfulCheckpoint(
    snapshot: Awaited<ReturnType<ExercisesDatasetClient["fetchSnapshot"]>>,
    transaction?: Parameters<
      ExercisesDatasetRepository["deactivateMissingExercises"]
    >[1],
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO integration.exercise_dataset_sync_state (
         source_key, source_url, source_version, content_sha256,
         fetched_at, refreshed_at, record_count
       ) VALUES (
         :sourceKey, :sourceUrl, :sourceVersion, :contentSha256,
         :fetchedAt, now(), :recordCount
       )
       ON CONFLICT (source_key) DO UPDATE SET
         source_url = EXCLUDED.source_url,
         source_version = EXCLUDED.source_version,
         content_sha256 = EXCLUDED.content_sha256,
         fetched_at = EXCLUDED.fetched_at,
         refreshed_at = EXCLUDED.refreshed_at,
         record_count = EXCLUDED.record_count,
         updated_at = now()`,
      {
        replacements: {
          sourceKey: DATASET_SOURCE_KEY,
          sourceUrl: snapshot.sourceUrl,
          sourceVersion: snapshot.sourceVersion,
          contentSha256: snapshot.contentSha256,
          fetchedAt: snapshot.fetchedAt,
          recordCount: snapshot.records.length,
        },
        transaction,
      },
    );
  }

  private resolveMediaBaseUrl(sourceUrl: string): string {
    const parsedSourceUrl = new URL(sourceUrl);
    return new URL("../", parsedSourceUrl).toString();
  }

  private resolveOpenMediaBaseUrl(): string {
    const url = new URL(env.EXERCISES_OPEN_MEDIA_BASE_URL);
    const allowedHosts = new Set(
      env.EXERCISES_DATASET_ALLOWED_HOSTS.map((host) => host.toLowerCase()),
    );
    if (
      url.protocol !== "https:" ||
      !allowedHosts.has(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new ServiceUnavailableException(
        "Open exercise media base URL is not an allowlisted HTTPS URL.",
      );
    }
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { ExercisesDatasetService } from "../modules/exercises/import/exercises-dataset.service";
import { sleep } from "./worker-loop";

export function millisecondsUntilDatasetRefresh(
  latestImportedAt: Date | null,
  now: Date,
  refreshIntervalMilliseconds: number,
): number {
  if (!latestImportedAt) return 0;
  return Math.max(
    0,
    latestImportedAt.getTime() + refreshIntervalMilliseconds - now.getTime(),
  );
}

@Injectable()
export class ExercisesDatasetRefreshRunner {
  private readonly logger = new Logger(ExercisesDatasetRefreshRunner.name);

  constructor(private readonly dataset: ExercisesDatasetService) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({
      event: "worker.started",
      worker: "exercises-dataset-refresh",
    });

    if (!env.EXERCISES_DATASET_ENABLED) {
      this.logger.warn({
        event: "exercises_dataset.refresh_disabled",
        detail: "The external dataset remains disabled by configuration.",
      });
      while (!signal.aborted) {
        await sleep(env.EXERCISES_DATASET_REFRESH_INTERVAL_MS, signal);
      }
      this.logger.log({
        event: "worker.stopped",
        worker: "exercises-dataset-refresh",
      });
      return;
    }

    while (!signal.aborted) {
      try {
        const latestImportedAt = await this.dataset.latestSuccessfulRefreshAt();
        const delay = millisecondsUntilDatasetRefresh(
          latestImportedAt,
          new Date(),
          env.EXERCISES_DATASET_REFRESH_INTERVAL_MS,
        );

        if (delay > 0) {
          this.logger.log({
            event: "exercises_dataset.refresh_scheduled",
            latestImportedAt,
            delayMilliseconds: delay,
          });
          await sleep(delay, signal);
          continue;
        }

        const result = await this.dataset.importDataset({
          dryRun: false,
          importMedia: env.EXERCISES_DATASET_IMPORT_MEDIA,
        });
        this.logger.log({
          event: "exercises_dataset.refresh_completed",
          sourceUrl: result.sourceUrl,
          sourceVersion: result.sourceVersion,
          contentSha256: result.contentSha256,
          unchangedSnapshot: result.unchangedSnapshot,
          totalRecords: result.totalRecords,
          createdExercises: result.createdExercises,
          updatedExercises: result.updatedExercises,
          deactivatedExercises: result.deactivatedExercises,
          fetchedAt: result.fetchedAt,
        });
      } catch (error: unknown) {
        this.logger.error({
          event: "exercises_dataset.refresh_failed",
          detail:
            "The previous PostgreSQL cache remains available; refresh will retry.",
          retryInMilliseconds: env.EXERCISES_DATASET_REFRESH_RETRY_MS,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
        await sleep(env.EXERCISES_DATASET_REFRESH_RETRY_MS, signal);
      }
    }

    this.logger.log({
      event: "worker.stopped",
      worker: "exercises-dataset-refresh",
    });
  }
}

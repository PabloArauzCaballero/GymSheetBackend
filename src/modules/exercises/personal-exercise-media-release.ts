import { Injectable, Logger } from "@nestjs/common";
import { Transaction } from "sequelize";
import { ExerciseType } from "../../common/enums/domain.enums";
import { ownMediaKey } from "../../common/media/own-media-key";
import { env } from "../../config/env";
import { MediaReferenceReleaseService } from "../media/media-reference-release.service";
import { MediaUploadTarget } from "../media/media-storage.port";
import { ExerciseMediaModel } from "./exercise-media.model";
import { ExerciseMediaRepository } from "./exercise-media.repository";
import { ExerciseModel } from "./exercise.model";

/** Folder of a member's personal exercise uploads inside their own storage folder. */
export const PERSONAL_EXERCISE_MEDIA_FOLDER = "ejercicios";

type ExerciseOwnership = Pick<ExerciseModel, "id" | "type" | "createdByUserId">;

/**
 * Where an upload to this exercise is stored. A PERSONAL exercise is its
 * owner's content, so its files go under `users/{owner}/ejercicios/{id}/` and
 * can be deleted (ADR-0017 §1); a GLOBAL one is catalog and stays under the
 * immutable `ejercicios/{id}/`.
 */
export function exerciseMediaTarget(exercise: ExerciseOwnership): MediaUploadTarget {
  if (exercise.type === ExerciseType.PERSONAL && exercise.createdByUserId) {
    return { category: "ejercicios", exerciseId: exercise.id, ownerUserId: exercise.createdByUserId };
  }
  return { category: "ejercicios", exerciseId: exercise.id };
}

/**
 * Storage keys of a media row that live in the personal exercise's owner
 * folder (the file and its poster). Catalog files, foreign URLs and rows
 * written before ADR-0017 under `ejercicios/` yield nothing: those stay.
 */
export function personalExerciseMediaKeys(
  media: Pick<ExerciseMediaModel, "url" | "thumbnailUrl">,
  exercise: ExerciseOwnership,
  publicBaseUrl: string = env.MEDIA_STORAGE_PUBLIC_BASE_URL,
): string[] {
  if (exercise.type !== ExerciseType.PERSONAL || !exercise.createdByUserId) return [];
  const owner = exercise.createdByUserId;
  return [media.url, media.thumbnailUrl]
    .map((url) => ownMediaKey(url, owner, PERSONAL_EXERCISE_MEDIA_FOLDER, publicBaseUrl))
    .filter((key): key is string => key !== null);
}

/**
 * Deletion of a member's uploads to their personal exercise. The row is
 * removed (an INACTIVE row would keep referencing the file forever) and the
 * file is released on `media.release` in the same transaction, unless another
 * row still references it (`MediaReferenceReleaseService`).
 *
 * Under an OPEN report on the exercise the uploads are evidence: they are held
 * (hidden, row and file kept) instead, so no release is queued, and the
 * reported-content retention erases them 180 days after the last report closed.
 */
@Injectable()
export class PersonalExerciseMediaRelease {
  private readonly logger = new Logger(PersonalExerciseMediaRelease.name);

  constructor(
    private readonly mediaRepository: ExerciseMediaRepository,
    private readonly release: MediaReferenceReleaseService,
  ) {}

  /** Removes (or holds) one row with own files. Returns false when the row has none (nothing to release). */
  async removeOne(media: ExerciseMediaModel, exercise: ExerciseOwnership): Promise<boolean> {
    const storageKeys = personalExerciseMediaKeys(media, exercise);
    if (storageKeys.length === 0) return false;
    let held = false;
    await this.release.clearAndRelease(
      { aggregateType: "exercise.media", aggregateId: media.id, storageKeys },
      async (transaction) => {
        held = await this.mediaRepository.holdIfExerciseReported(media.exerciseId, [media.id], transaction);
        if (!held) await this.mediaRepository.destroy(media, transaction);
        if (media.isPrimary) await this.mediaRepository.promoteFirstActive(media.exerciseId, transaction);
      },
    );
    if (held) this.logger.log({ event: "exercise_media.held_as_evidence", exerciseId: media.exerciseId, count: 1 });
    return true;
  }

  /**
   * Deleting a personal exercise releases every file its owner uploaded to it,
   * in the transaction that runs `alsoInTransaction` (the exercise's own change).
   * Rows already held as evidence are left to the reported-content retention.
   */
  async removeAllOf(
    exercise: ExerciseOwnership,
    alsoInTransaction: (transaction: Transaction) => Promise<void>,
  ): Promise<void> {
    const rows = (await this.mediaRepository.listAllByExercise(exercise.id))
      .filter((media) => !media.authorDeletedAt)
      .map((media) => ({ media, keys: personalExerciseMediaKeys(media, exercise) }))
      .filter((row) => row.keys.length > 0);
    let held = false;
    await this.release.clearAndRelease(
      { aggregateType: "exercise", aggregateId: exercise.id, storageKeys: rows.flatMap((row) => row.keys) },
      async (transaction) => {
        held = await this.mediaRepository.holdIfExerciseReported(exercise.id, rows.map((row) => row.media.id), transaction);
        if (!held) for (const { media } of rows) await this.mediaRepository.destroy(media, transaction);
        await alsoInTransaction(transaction);
      },
    );
    if (held) this.logger.log({ event: "exercise_media.held_as_evidence", exerciseId: exercise.id, count: rows.length });
  }

  /** A re-upload with the same identity moved the row to a new object: the replaced own file goes. */
  async releaseReplaced(previousUrl: string, current: ExerciseMediaModel, exercise: ExerciseOwnership): Promise<void> {
    const storageKeys = personalExerciseMediaKeys({ url: previousUrl, thumbnailUrl: null }, exercise);
    if (storageKeys.length === 0 || current.url === previousUrl) return;
    await this.release.clearAndRelease(
      { aggregateType: "exercise.media", aggregateId: current.id, storageKeys },
      () => Promise.resolve(),
    );
  }
}

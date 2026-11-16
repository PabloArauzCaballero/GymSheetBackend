import { Injectable } from "@nestjs/common";
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
 */
@Injectable()
export class PersonalExerciseMediaRelease {
  constructor(
    private readonly mediaRepository: ExerciseMediaRepository,
    private readonly release: MediaReferenceReleaseService,
  ) {}

  /** Removes one row with own files. Returns false when the row has none (nothing to release). */
  async removeOne(media: ExerciseMediaModel, exercise: ExerciseOwnership): Promise<boolean> {
    const storageKeys = personalExerciseMediaKeys(media, exercise);
    if (storageKeys.length === 0) return false;
    await this.release.clearAndRelease(
      { aggregateType: "exercise.media", aggregateId: media.id, storageKeys },
      async (transaction) => {
        await this.mediaRepository.destroy(media, transaction);
        if (media.isPrimary) await this.mediaRepository.promoteFirstActive(media.exerciseId, transaction);
      },
    );
    return true;
  }

  /**
   * Deleting a personal exercise releases every file its owner uploaded to it,
   * in the transaction that runs `alsoInTransaction` (the exercise's own change).
   */
  async removeAllOf(
    exercise: ExerciseOwnership,
    alsoInTransaction: (transaction: Transaction) => Promise<void>,
  ): Promise<void> {
    const rows = (await this.mediaRepository.listAllByExercise(exercise.id))
      .map((media) => ({ media, keys: personalExerciseMediaKeys(media, exercise) }))
      .filter((row) => row.keys.length > 0);
    await this.release.clearAndRelease(
      { aggregateType: "exercise", aggregateId: exercise.id, storageKeys: rows.flatMap((row) => row.keys) },
      async (transaction) => {
        for (const { media } of rows) await this.mediaRepository.destroy(media, transaction);
        await alsoInTransaction(transaction);
      },
    );
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

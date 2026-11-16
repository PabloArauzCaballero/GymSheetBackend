import { ExerciseType } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { MediaReferenceReleaseService } from "../media/media-reference-release.service";
import { ExerciseMediaModel } from "./exercise-media.model";
import { ExerciseMediaRepository } from "./exercise-media.repository";
import {
  PersonalExerciseMediaRelease,
  exerciseMediaTarget,
  personalExerciseMediaKeys,
} from "./personal-exercise-media-release";

const base = "https://media.example.test/media";
const ownerId = "6a1c0f5e-3b7d-4c2a-9e1f-0b8d7c6a5e4f";
const otherId = "7b2d1a6f-4c8e-4d3b-8f2a-1c9e8d7b6a5f";
const exerciseId = "d02730ac-b0cd-4cd3-8570-d3c22b5d8c0f";
const personal = { id: exerciseId, type: ExerciseType.PERSONAL, createdByUserId: ownerId };
const global = { id: exerciseId, type: ExerciseType.GLOBAL, createdByUserId: null };
const ownKey = `users/${ownerId}/ejercicios/${exerciseId}/${"a".repeat(64)}.mp4`;

describe("exerciseMediaTarget", () => {
  it("puts a personal exercise's upload in its owner's folder and a global one in the catalog", () => {
    expect(exerciseMediaTarget(personal)).toEqual({ category: "ejercicios", exerciseId, ownerUserId: ownerId });
    expect(exerciseMediaTarget(global)).toEqual({ category: "ejercicios", exerciseId });
  });
});

describe("personalExerciseMediaKeys", () => {
  it("yields the keys in the owner's exercise folder, file and poster", () => {
    const poster = `users/${ownerId}/ejercicios/${exerciseId}/${"b".repeat(64)}.webp`;
    expect(
      personalExerciseMediaKeys({ url: `${base}/${ownKey}`, thumbnailUrl: `${base}/${poster}` }, personal, base),
    ).toEqual([ownKey, poster]);
  });

  it("never yields catalog keys, other people's files, traversal or foreign URLs", () => {
    const keys = (url: string) => personalExerciseMediaKeys({ url, thumbnailUrl: null }, personal, base);
    expect(keys(`${base}/ejercicios/${exerciseId}/x.mp4`)).toEqual([]);
    expect(keys(`${base}/users/${otherId}/ejercicios/${exerciseId}/x.mp4`)).toEqual([]);
    expect(keys(`${base}/users/${ownerId}/ejercicios/../../${otherId}/perfiles/x.jpg`)).toEqual([]);
    expect(keys(`https://other.example.test/media/${ownKey}`)).toEqual([]);
    expect(personalExerciseMediaKeys({ url: `${base}/${ownKey}`, thumbnailUrl: null }, global, base)).toEqual([]);
  });
});

describe("PersonalExerciseMediaRelease", () => {
  function setup(rows: Partial<ExerciseMediaModel>[] = []) {
    const transaction = { id: "tx" };
    const repository = {
      destroy: jest.fn().mockResolvedValue(undefined),
      promoteFirstActive: jest.fn().mockResolvedValue(undefined),
      listAllByExercise: jest.fn().mockResolvedValue(rows),
    };
    const release = {
      clearAndRelease: jest.fn(async (_cleared: unknown, clear: (t: unknown) => Promise<void>) => {
        await clear(transaction);
        return 1;
      }),
    };
    const service = new PersonalExerciseMediaRelease(
      repository as unknown as ExerciseMediaRepository,
      release as unknown as MediaReferenceReleaseService,
    );
    return { service, repository, release, transaction };
  }
  const url = `${env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/u, "")}/${ownKey}`;

  it("deletes the row of an own upload and releases its file in the same transaction", async () => {
    const { service, repository, release, transaction } = setup();
    const media = { id: "m1", exerciseId, url, thumbnailUrl: null, isPrimary: true } as ExerciseMediaModel;

    await expect(service.removeOne(media, personal)).resolves.toBe(true);
    expect(release.clearAndRelease).toHaveBeenCalledWith(
      { aggregateType: "exercise.media", aggregateId: "m1", storageKeys: [ownKey] },
      expect.any(Function),
    );
    expect(repository.destroy).toHaveBeenCalledWith(media, transaction);
    expect(repository.promoteFirstActive).toHaveBeenCalledWith(exerciseId, transaction);
  });

  it("leaves catalog media to the deactivation path", async () => {
    const { service, release } = setup();
    const media = { id: "m1", exerciseId, url, thumbnailUrl: null, isPrimary: false } as ExerciseMediaModel;

    await expect(service.removeOne(media, global)).resolves.toBe(false);
    expect(release.clearAndRelease).not.toHaveBeenCalled();
  });

  it("deleting a personal exercise releases every own upload, with the exercise change in the same transaction", async () => {
    const own = { id: "m1", url, thumbnailUrl: null };
    const external = { id: "m2", url: "https://videos.example.test/x.mp4", thumbnailUrl: null };
    const { service, repository, release, transaction } = setup([own, external]);
    const markInactive = jest.fn().mockResolvedValue(undefined);

    await service.removeAllOf(personal, markInactive);
    expect(release.clearAndRelease).toHaveBeenCalledWith(
      { aggregateType: "exercise", aggregateId: exerciseId, storageKeys: [ownKey] },
      expect.any(Function),
    );
    expect(repository.destroy).toHaveBeenCalledTimes(1);
    expect(repository.destroy).toHaveBeenCalledWith(own, transaction);
    expect(markInactive).toHaveBeenCalledWith(transaction);
  });
});

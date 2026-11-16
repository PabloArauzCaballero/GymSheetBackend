import { Transaction } from "sequelize";
import { MediaStorageProvider } from "../media/media-storage.port";
import { NotificationService } from "../notifications/notification.service";
import { PhotoVerificationModel } from "./photo-verification.model";
import { VerificationRepository } from "./verification.repository";
import { VerificationRetentionService } from "./verification-retention.service";
import { VerificationRevocationService } from "./verification-revocation.service";

const userId = "00000000-0000-4000-8000-000000000001";
const tx = { id: "tx" } as unknown as Transaction;
const now = new Date("2026-11-20T12:00:00.000Z");

describe("VerificationRevocationService (photo replacement rule)", () => {
  function setup(existingCompared: number, verifiedAt: Date | null = now) {
    const repository = {
      lockUser: jest.fn().mockResolvedValue({ verifiedAt }),
      findLatestApproved: jest.fn().mockResolvedValue({ id: "v1", approvedPhotoIds: ["p1", "p2"] }),
      countExistingPhotos: jest.fn().mockResolvedValue(existingCompared),
      setUserVerifiedAt: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
    const service = new VerificationRevocationService(
      repository as unknown as VerificationRepository,
      notifications as unknown as NotificationService,
      () => now,
    );
    return { service, repository, notifications };
  }

  it("keeps the verification while any compared photo remains (adding photos changes nothing)", async () => {
    const { service, repository, notifications } = setup(1);
    await expect(service.revokeIfComparedPhotosGone(userId, tx)).resolves.toBe(false);
    expect(repository.countExistingPhotos).toHaveBeenCalledWith(userId, ["p1", "p2"], tx);
    expect(repository.setUserVerifiedAt).not.toHaveBeenCalled();
    expect(notifications.enqueueDirectMessage).not.toHaveBeenCalled();
  });

  it("clears verified_at, stamps the approval and notifies once all compared photos are gone", async () => {
    const { service, repository, notifications } = setup(0);
    await expect(service.revokeIfComparedPhotosGone(userId, tx)).resolves.toBe(true);
    expect(repository.setUserVerifiedAt).toHaveBeenCalledWith(userId, null, tx);
    expect(repository.update).toHaveBeenCalledWith("v1", { revokedAt: now }, tx);
    expect(notifications.enqueueDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: userId, deduplicationKey: "verification.revoked:v1" }),
      tx,
    );
  });

  it("does nothing for a member who is not verified", async () => {
    const { service, repository } = setup(0, null);
    await expect(service.revokeIfComparedPhotosGone(userId, tx)).resolves.toBe(false);
    expect(repository.findLatestApproved).not.toHaveBeenCalled();
  });
});

describe("VerificationRetentionService (fixed clock)", () => {
  const withSelfie = (id: string) => ({ id, selfieStorageKey: `users/u/verificaciones/${id}.jpg` }) as PhotoVerificationModel;

  function setup(rows: PhotoVerificationModel[], storageOverrides: Partial<MediaStorageProvider> = {}) {
    let pending = [...rows];
    const repository = {
      expireAbandoned: jest.fn().mockResolvedValue(2),
      findSelfiesToErase: jest.fn(async () => pending),
      clearSelfie: jest.fn(async (id: string) => {
        pending = pending.filter((row) => row.id !== id);
      }),
    };
    const storage = { immutable: false, remove: jest.fn().mockResolvedValue(undefined), ...storageOverrides };
    const sleep = jest.fn().mockResolvedValue(undefined);
    const service = new VerificationRetentionService(
      repository as unknown as VerificationRepository,
      storage as unknown as MediaStorageProvider,
      sleep,
    );
    return { service, repository, storage, sleep };
  }

  it("expires abandoned challenges and erases due selfies with the 24 h / 30 day cut-offs", async () => {
    const { service, repository, storage } = setup([withSelfie("a"), withSelfie("b")]);
    await expect(service.purge(now)).resolves.toEqual({ expiredChallenges: 2, selfiesErased: 2, failed: 0 });
    expect(repository.expireAbandoned).toHaveBeenCalledWith(new Date("2026-11-19T12:00:00.000Z"));
    expect(repository.findSelfiesToErase).toHaveBeenCalledWith(new Date("2026-10-21T12:00:00.000Z"), 100);
    expect(storage.remove).toHaveBeenCalledWith("users/u/verificaciones/a.jpg");
    expect(repository.clearSelfie).toHaveBeenCalledWith("a", "users/u/verificaciones/a.jpg", now);
  });

  it("retries the storage with backoff and keeps the key when it keeps failing", async () => {
    const remove = jest.fn().mockRejectedValue(new Error("storage down"));
    const { service, repository, sleep } = setup([withSelfie("a")], { remove });
    await expect(service.purge(now)).resolves.toEqual({ expiredChallenges: 2, selfiesErased: 0, failed: 1 });
    expect(remove).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[200], [400]]);
    expect(repository.clearSelfie).not.toHaveBeenCalled();
  });

  it("recovers on a later attempt within the same run", async () => {
    const remove = jest.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue(undefined);
    const { service, repository } = setup([withSelfie("a")], { remove });
    await expect(service.purge(now)).resolves.toMatchObject({ selfiesErased: 1, failed: 0 });
    expect(repository.clearSelfie).toHaveBeenCalledTimes(1);
  });

  it("never claims an erasure on immutable storage", async () => {
    const { service, storage, repository } = setup([withSelfie("a")], { immutable: true });
    await expect(service.purge(now)).resolves.toMatchObject({ selfiesErased: 0, failed: 1 });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(repository.clearSelfie).not.toHaveBeenCalled();
  });
});

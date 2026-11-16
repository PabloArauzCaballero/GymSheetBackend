import { Transaction } from "sequelize";
import type { MediaReleaseService } from "../media/media-release.service";
import { NotificationService } from "../notifications/notification.service";
import { VerificationRepository } from "./verification.repository";
import { VERIFICATION_SELFIE_AGGREGATE, VerificationRetentionService } from "./verification-retention.service";
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
  const due = (id: string) => ({ id, storageKey: `users/u/verificaciones/${id}.jpg` });

  function setup(batches: Array<ReturnType<typeof due>[]>, staleReviews: Array<{ id: string; userId: string }[]> = []) {
    const repository = {
      expireAbandoned: jest.fn().mockResolvedValue(2),
      runInTransaction: jest.fn((work: (t: Transaction) => Promise<unknown>) => work(tx)),
      expireStaleReviews: jest.fn(async () => staleReviews.shift() ?? []),
      clearDueSelfies: jest.fn(async () => batches.shift() ?? []),
    };
    const mediaRelease = { requestRelease: jest.fn().mockResolvedValue(undefined) };
    const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
    const service = new VerificationRetentionService(
      repository as unknown as VerificationRepository,
      mediaRelease as unknown as MediaReleaseService,
      notifications as unknown as NotificationService,
    );
    return { service, repository, mediaRelease, notifications };
  }

  it("expires abandoned challenges and clears due selfies with the 24 h / 30 day cut-offs", async () => {
    const { service, repository } = setup([[due("a"), due("b")]]);
    await expect(service.purge(now)).resolves.toEqual({ expiredChallenges: 2, expiredReviews: 0, selfiesErased: 2 });
    expect(repository.expireAbandoned).toHaveBeenCalledWith(new Date("2026-11-19T12:00:00.000Z"));
    expect(repository.clearDueSelfies).toHaveBeenCalledWith(new Date("2026-10-21T12:00:00.000Z"), now, 100, tx);
  });

  it("closes reviews undecided for 30 days before clearing selfies and tells each member in that transaction", async () => {
    const order: string[] = [];
    const { service, repository, notifications } = setup([[due("r1")]], [[{ id: "r1", userId }]]);
    repository.expireStaleReviews.mockImplementationOnce(async () => {
      order.push("expire");
      return [{ id: "r1", userId }];
    });
    repository.clearDueSelfies.mockImplementationOnce(async () => {
      order.push("clear");
      return [due("r1")];
    });
    await expect(service.purge(now)).resolves.toEqual({ expiredChallenges: 2, expiredReviews: 1, selfiesErased: 1 });
    expect(order).toEqual(["expire", "clear"]);
    expect(repository.expireStaleReviews).toHaveBeenCalledWith(new Date("2026-10-21T12:00:00.000Z"), 100, tx);
    expect(notifications.enqueueDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: userId,
        channel: "IN_APP",
        deduplicationKey: "verification.review-expired:r1",
        metadata: { kind: "PHOTO_VERIFICATION", verificationId: "r1", outcome: "REVIEW_EXPIRED" },
      }),
      tx,
    );
    const [notice] = notifications.enqueueDirectMessage.mock.calls[0];
    expect(notice.body).toContain("El equipo de REPP");
    expect(notice.body).toContain("intentarlo de nuevo");
    expect(notice.body).not.toMatch(/gimnasio/iu);
  });

  it("queues each file on media.release in the transaction that cleared its key (no in-process storage call)", async () => {
    const { service, mediaRelease } = setup([[due("a")]]);
    await service.purge(now);
    expect(mediaRelease.requestRelease).toHaveBeenCalledWith(
      { aggregateType: VERIFICATION_SELFIE_AGGREGATE, aggregateId: "a", storageKey: "users/u/verificaciones/a.jpg" },
      tx,
    );
  });

  it("keeps taking batches until one comes back short", async () => {
    const full = Array.from({ length: 100 }, (_, index) => due(`f${index}`));
    const { service, repository, mediaRelease } = setup([full, [due("last")]]);
    await expect(service.purge(now)).resolves.toEqual({ expiredChallenges: 2, expiredReviews: 0, selfiesErased: 101 });
    expect(repository.clearDueSelfies).toHaveBeenCalledTimes(2);
    expect(mediaRelease.requestRelease).toHaveBeenCalledTimes(101);
  });
});

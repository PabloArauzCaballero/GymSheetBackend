import type { OutboxJobModel } from "../integration/outbox-job.model";
import type { OutboxService } from "../integration/outbox.service";
import { MEDIA_RELEASE_QUEUE, MediaReleaseService } from "./media-release.service";
import type { MediaRetentionService } from "./media-retention.service";
import type { MediaStorageProvider } from "./media-storage.port";

function job(payload: Record<string, unknown>, aggregateType = "chat.message"): OutboxJobModel {
  return { id: "job-1", aggregateType, attemptCount: 1, payload } as unknown as OutboxJobModel;
}

function setup(jobs: OutboxJobModel[], removal: jest.Mock = jest.fn().mockResolvedValue({ fileRemoved: true })) {
  const outbox = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    claim: jest.fn().mockResolvedValue(jobs),
    complete: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue({ deadLetter: false, updated: true }),
  };
  const retention = { deleteRowAndUnreferencedFile: removal };
  const storage = { name: "local" } as MediaStorageProvider;
  const service = new MediaReleaseService(
    outbox as unknown as OutboxService,
    retention as unknown as MediaRetentionService,
    storage,
  );
  return { service, outbox, retention };
}

describe("MediaReleaseService", () => {
  it("skips an unsafe key without throwing, so one bad row never aborts a batch", async () => {
    const { service, outbox } = setup([]);
    await expect(
      service.requestRelease(
        { aggregateType: "community.comment", aggregateId: "c1", storageKey: "users/u1/../u2/x.jpg" },
        {} as never,
      ),
    ).resolves.toBeUndefined();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues an idempotent release job inside the caller transaction", async () => {
    const { service, outbox } = setup([]);
    const transaction = {} as never;
    await service.requestRelease(
      { aggregateType: "chat.message", aggregateId: "m1", provider: "local", storageKey: "k1" },
      transaction,
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: MEDIA_RELEASE_QUEUE,
        deduplicationKey: "media-release:chat.message:m1:k1",
        payload: { schemaVersion: 1, provider: "local", storageKey: "k1" },
      }),
      transaction,
    );
  });

  it("removes the unreferenced file through the retention service and completes the job", async () => {
    const { service, outbox, retention } = setup([job({ schemaVersion: 1, provider: "local", storageKey: "k1" })]);
    await expect(service.drainOnce(10)).resolves.toBe(1);
    expect(retention.deleteRowAndUnreferencedFile).toHaveBeenCalledWith("k1", expect.any(Function));
    expect(outbox.complete).toHaveBeenCalled();
    expect(outbox.fail).not.toHaveBeenCalled();
  });

  it("marks the job failed (retried with backoff) when the storage is unavailable", async () => {
    const removal = jest.fn().mockRejectedValue(new Error("storage unreachable"));
    const { service, outbox } = setup([job({ schemaVersion: 1, provider: "local", storageKey: "k1" })], removal);
    await expect(service.drainOnce(10)).resolves.toBe(0);
    expect(outbox.fail).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }), expect.any(String), expect.any(Error));
    expect(outbox.complete).not.toHaveBeenCalled();
  });

  it("refuses a job written for another storage provider", async () => {
    const { service, outbox, retention } = setup([job({ schemaVersion: 1, provider: "minio", storageKey: "k1" })]);
    await service.drainOnce(10);
    expect(retention.deleteRowAndUnreferencedFile).not.toHaveBeenCalled();
    expect(outbox.fail).toHaveBeenCalled();
  });

  it("stamps the configured provider when the caller's rows do not record one (account closure)", async () => {
    const { service, outbox } = setup([]);
    const transaction = {} as never;
    await service.requestRelease({ aggregateType: "account", aggregateId: "u1", storageKey: "users/u1/perfiles/1.jpg" }, transaction);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: MEDIA_RELEASE_QUEUE,
        aggregateType: "account",
        deduplicationKey: "media-release:account:u1:users/u1/perfiles/1.jpg",
        payload: { schemaVersion: 1, provider: "local", storageKey: "users/u1/perfiles/1.jpg" },
      }),
      transaction,
    );
  });

  it("releases each closed-account key through the shared-reference check, keeping a file still in use", async () => {
    const removal = jest.fn().mockResolvedValueOnce({ fileRemoved: true }).mockResolvedValueOnce({ fileRemoved: false });
    const jobs = ["users/a/perfiles/1.jpg", "users/a/chats/c/2.bin"].map((storageKey) =>
      job({ schemaVersion: 1, provider: "local", storageKey }, "account"));
    const { service, outbox, retention } = setup(jobs, removal);
    await expect(service.drainOnce(10)).resolves.toBe(2);
    expect(retention.deleteRowAndUnreferencedFile).toHaveBeenCalledTimes(2);
    expect(retention.deleteRowAndUnreferencedFile).toHaveBeenNthCalledWith(1, "users/a/perfiles/1.jpg", expect.any(Function));
    expect(outbox.complete).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed job so the outbox retries and dead-letters it", async () => {
    const { service, outbox, retention } = setup([job({ storageKeys: "nope" }, "account")]);
    await expect(service.drainOnce(10)).resolves.toBe(0);
    expect(retention.deleteRowAndUnreferencedFile).not.toHaveBeenCalled();
    expect(outbox.fail).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }), expect.any(String), expect.any(Error));
  });
});

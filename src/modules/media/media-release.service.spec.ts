import type { OutboxJobModel } from "../integration/outbox-job.model";
import type { OutboxService } from "../integration/outbox.service";
import { MEDIA_RELEASE_QUEUE, MediaReleaseService } from "./media-release.service";
import type { MediaRetentionService } from "./media-retention.service";
import type { MediaStorageProvider } from "./media-storage.port";

function job(payload: Record<string, unknown>): OutboxJobModel {
  return { id: "job-1", aggregateType: "chat.message", attemptCount: 1, payload } as unknown as OutboxJobModel;
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
});

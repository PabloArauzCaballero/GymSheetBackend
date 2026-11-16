import { Readable } from "stream";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { OutboxJobModel } from "../integration/outbox-job.model";
import type { OutboxService } from "../integration/outbox.service";
import type { MediaReferencesRepository } from "./media-references.repository";

const mockListObjects = jest.fn();
const mockRemoveObject = jest.fn();

jest.mock("minio", () => ({
  Client: jest.fn().mockImplementation(() => ({ listObjects: mockListObjects, removeObject: mockRemoveObject })),
}));

// After `jest.mock` on purpose: the adapter builds its `Client` in the constructor.
import { MinioStorageAdapter } from "./adapters/minio-storage.adapter";
import { MediaReleaseService } from "./media-release.service";
import { MediaRetentionService } from "./media-retention.service";

const KEY = "users/11111111-1111-4111-8111-111111111111/chats/conv-1/abc.jpg";

/**
 * The media.release job end to end over the real retention service and the
 * real MinIO adapter (only the SDK and the database are doubles): this is the
 * path a "delete for everyone" and an account closure take in production.
 */
function setup(referenced = false) {
  const transaction = {} as Transaction;
  const sequelize = {
    transaction: jest.fn(async (run: (t: Transaction) => Promise<unknown>) => run(transaction)),
  } as unknown as Sequelize;
  const references = {
    lockStorageKey: jest.fn().mockResolvedValue(undefined),
    isReferenced: jest.fn().mockResolvedValue(referenced),
  } as unknown as MediaReferencesRepository;
  const storage = new MinioStorageAdapter({
    endPoint: "minio",
    port: 9000,
    useSSL: false,
    accessKey: "gymsheet-api",
    secretKey: "a-secret-long-enough-for-the-env-schema",
    bucket: "gymsheet-media",
    region: "us-east-1",
    publicBaseUrl: "https://media.example.test",
    userContentDeletable: true,
  });
  const job = {
    id: "job-1",
    aggregateType: "chat.message",
    attemptCount: 1,
    payload: { schemaVersion: 1, provider: "minio", storageKey: KEY },
  } as unknown as OutboxJobModel;
  const outbox = {
    claim: jest.fn().mockResolvedValue([job]),
    complete: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue({ deadLetter: false, updated: true }),
  };
  const service = new MediaReleaseService(
    outbox as unknown as OutboxService,
    new MediaRetentionService(sequelize, references, storage),
    storage,
  );
  return { service, outbox };
}

describe("media.release over MinIO (ADR-0017)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("erases every version of the released key and completes the job", async () => {
    mockListObjects.mockReturnValue(Readable.from([
      { name: KEY, versionId: "v2", isDeleteMarker: true },
      { name: KEY, versionId: "v1", isDeleteMarker: false },
    ]));
    mockRemoveObject.mockResolvedValue(undefined);
    const { service, outbox } = setup();

    await expect(service.drainOnce(10)).resolves.toBe(1);

    expect(mockRemoveObject).toHaveBeenCalledTimes(2);
    expect(outbox.complete).toHaveBeenCalled();
    expect(outbox.fail).not.toHaveBeenCalled();
  });

  /** Without the delete policy the job must stay visible, never complete. */
  it("fails the job (retry, then dead-letter) when MinIO denies the removal", async () => {
    mockListObjects.mockReturnValue(Readable.from([{ name: KEY, versionId: "v1" }]));
    mockRemoveObject.mockRejectedValue(Object.assign(new Error("Access Denied."), { code: "AccessDenied" }));
    const { service, outbox } = setup();

    await expect(service.drainOnce(10)).resolves.toBe(0);

    expect(outbox.complete).not.toHaveBeenCalled();
    expect(outbox.fail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      expect.any(String),
      expect.objectContaining({ code: "AccessDenied" }),
    );
  });

  it("keeps a file another row still references (moderation evidence included)", async () => {
    const { service, outbox } = setup(true);

    await expect(service.drainOnce(10)).resolves.toBe(1);

    expect(mockListObjects).not.toHaveBeenCalled();
    expect(mockRemoveObject).not.toHaveBeenCalled();
    expect(outbox.complete).toHaveBeenCalled();
  });
});

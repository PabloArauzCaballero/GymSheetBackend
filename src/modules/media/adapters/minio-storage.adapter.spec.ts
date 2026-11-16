import { createHash } from "crypto";
import { Readable } from "stream";
import { MediaUploadInput, MediaUploadTarget } from "../media-storage.port";

const mockStatObject = jest.fn();
const mockPutObject = jest.fn();
const mockRemoveObject = jest.fn();
const mockGetObject = jest.fn();
const mockListObjects = jest.fn();

jest.mock("minio", () => ({
  Client: jest.fn().mockImplementation(() => ({
    statObject: mockStatObject,
    putObject: mockPutObject,
    removeObject: mockRemoveObject,
    getObject: mockGetObject,
    listObjects: mockListObjects,
  })),
}));

import { Logger } from "@nestjs/common";
// Después del `jest.mock` a propósito: el adaptador construye su `Client` en el
// constructor, así que tiene que ver ya el doble y no el SDK real.
import { MinioStorageAdapter } from "./minio-storage.adapter";

const OWNER = "11111111-1111-4111-8111-111111111111";

/** Error tal y como lo señala el SDK cuando el objeto no existe. */
function notFound(): Error & { code: string } {
  return Object.assign(new Error("Not Found"), { code: "NotFound" });
}

function makeInput(overrides: Partial<MediaUploadInput> = {}): MediaUploadInput {
  return {
    originalName: "cover.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 3,
    buffer: Buffer.from("abc"),
    ...overrides,
  };
}

/** AccessDenied as the SDK raises it while the delete policy is missing. */
function accessDenied(): Error & { code: string } {
  return Object.assign(new Error("Access Denied."), { code: "AccessDenied" });
}

/** A versioned listing as the SDK streams it: objects and delete markers. */
function listing(items: Array<Record<string, unknown>>): Readable {
  return Readable.from(items);
}

function createAdapter(userContentDeletable = true): MinioStorageAdapter {
  return new MinioStorageAdapter({
    endPoint: "minio",
    port: 9000,
    useSSL: false,
    accessKey: "gymsheet-api",
    secretKey: "a-secret-long-enough-for-the-env-schema",
    bucket: "gymsheet-media",
    region: "us-east-1",
    publicBaseUrl: "https://gymsheet-media.example.ts.net/",
    userContentDeletable,
  });
}

describe("MinioStorageAdapter", () => {
  let adapter: MinioStorageAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = createAdapter();
  });

  it("stores the object under its owner's folder and returns the public URL", async () => {
    mockStatObject.mockRejectedValue(notFound());
    const input = makeInput();
    const sha = createHash("sha256").update(input.buffer).digest("hex");

    const stored = await adapter.upload(input, {
      category: "stories",
      ownerUserId: OWNER,
    });

    const key = `users/${OWNER}/stories/${sha}.jpg`;
    expect(stored.provider).toBe("minio");
    expect(stored.key).toBe(key);
    // La barra final de la base pública se normaliza a un solo separador.
    expect(stored.url).toBe(`https://gymsheet-media.example.ts.net/${key}`);
    expect(stored.reused).toBe(false);

    const [bucket, objectKey, buffer, size, metadata] =
      mockPutObject.mock.calls[0];
    expect(bucket).toBe("gymsheet-media");
    expect(objectKey).toBe(key);
    expect(buffer).toBe(input.buffer);
    expect(size).toBe(input.buffer.byteLength);
    // El Content-Type sale del MIME validado, nunca del nombre del cliente.
    expect(metadata["Content-Type"]).toBe("image/jpeg");
    expect(metadata["Content-Disposition"]).toBe("attachment");
  });

  it("nests a chat attachment under its conversation", async () => {
    mockStatObject.mockRejectedValue(notFound());

    const stored = await adapter.upload(makeInput(), {
      category: "chats",
      ownerUserId: OWNER,
      conversationId: "conv-7",
    });

    expect(stored.key.startsWith(`users/${OWNER}/chats/conv-7/`)).toBe(true);
  });

  it("stores reels under a dedicated owner-scoped key prefix", async () => {
    mockStatObject.mockRejectedValue(notFound());

    const stored = await adapter.upload(makeInput(), {
      category: "reels",
      ownerUserId: OWNER,
    });

    expect(stored.key).toMatch(new RegExp(`^users/${OWNER}/reels/[a-f0-9]{64}\\.jpg$`));
    expect(stored.key).not.toContain("publicaciones");
  });

  it("reads object bytes through the authenticated server-side storage port", async () => {
    mockGetObject.mockResolvedValue(Readable.from([Buffer.from("private-media")]));

    await expect(adapter.download("users/a/chats/c/file.jpg")).resolves.toEqual(Buffer.from("private-media"));
    expect(mockGetObject).toHaveBeenCalledWith("gymsheet-media", "users/a/chats/c/file.jpg");
  });

  describe("remove (ADR-0017)", () => {
    const key = `users/${OWNER}/stories/abc.jpg`;

    /**
     * The bucket is versioned: a DELETE without versionId only stacks a delete
     * marker and the bytes stay recoverable. Every version and every marker of
     * the exact key must go, and a sibling that shares the prefix must stay.
     */
    it("removes every version of a person's object, delete markers included", async () => {
      mockListObjects.mockReturnValue(
        listing([
          { name: key, versionId: "v3", isDeleteMarker: true },
          { name: key, versionId: "v2", isDeleteMarker: false },
          { name: key, versionId: "v1", isDeleteMarker: false },
          { name: `${key}.bak`, versionId: "v9", isDeleteMarker: false },
        ]),
      );
      mockRemoveObject.mockResolvedValue(undefined);

      await expect(adapter.remove(key)).resolves.toBeUndefined();

      expect(mockListObjects).toHaveBeenCalledWith("gymsheet-media", key, true, { IncludeVersion: true });
      expect(mockRemoveObject.mock.calls).toEqual([
        ["gymsheet-media", key, { versionId: "v3" }],
        ["gymsheet-media", key, { versionId: "v2" }],
        ["gymsheet-media", key, { versionId: "v1" }],
      ]);
    });

    it("removes the single object of an unversioned bucket by its null version", async () => {
      mockListObjects.mockReturnValue(listing([{ name: key }]));

      await adapter.remove(key);

      expect(mockRemoveObject).toHaveBeenCalledWith("gymsheet-media", key, { versionId: "null" });
    });

    it("is idempotent when nothing is left under the key", async () => {
      mockListObjects.mockReturnValue(listing([]));

      await expect(adapter.remove(key)).resolves.toBeUndefined();
      expect(mockRemoveObject).not.toHaveBeenCalled();
    });

    /** ADR-0010 still holds for the catalog: a code bug cannot delete it. */
    it.each(["catalog/abc.jpg", "ejercicios/ex-1/abc.mp4", `users/${OWNER}/../../catalog/abc.jpg`])(
      "refuses %s with a logged no-op",
      async (immutableKey) => {
        const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

        await expect(adapter.remove(immutableKey)).resolves.toBeUndefined();

        expect(adapter.canRemove(immutableKey)).toBe(false);
        expect(mockListObjects).not.toHaveBeenCalled();
        expect(mockRemoveObject).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({ event: "media.remove.immutable_key", reason: "catalog_key", key: immutableKey }),
        );
        log.mockRestore();
      },
    );

    it("keeps a person's content when the deployment does not declare deletion", async () => {
      const keeping = createAdapter(false);
      const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

      await keeping.remove(key);

      expect(keeping.canRemove(key)).toBe(false);
      expect(mockRemoveObject).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: "media.remove.immutable_key", reason: "user_content_not_deletable" }),
      );
      log.mockRestore();
    });

    it("declares a person's content deletable and the catalog not", () => {
      expect(adapter.canRemove(key)).toBe(true);
      expect(adapter.canRemove(`users/${OWNER}/chats/conv-7/abc.jpg`)).toBe(true);
      expect(adapter.canRemove("catalog/abc.jpg")).toBe(false);
    });

    /**
     * Without the ADR-0017 policy MinIO answers AccessDenied. Swallowing it
     * would complete the media.release job over a file that still exists.
     */
    it("propagates AccessDenied from a version removal", async () => {
      mockListObjects.mockReturnValue(listing([{ name: key, versionId: "v1" }]));
      mockRemoveObject.mockRejectedValue(accessDenied());

      await expect(adapter.remove(key)).rejects.toMatchObject({ code: "AccessDenied" });
    });

    it("propagates AccessDenied from the version listing", async () => {
      const failing = new Readable({ objectMode: true, read() { this.destroy(accessDenied()); } });
      mockListObjects.mockReturnValue(failing);

      await expect(adapter.remove(key)).rejects.toMatchObject({ code: "AccessDenied" });
      expect(mockRemoveObject).not.toHaveBeenCalled();
    });
  });

  it("reuses an existing object instead of rewriting it", async () => {
    mockStatObject.mockResolvedValue({ size: 3 });

    const stored = await adapter.upload(makeInput(), {
      category: "perfiles",
      ownerUserId: OWNER,
    });

    expect(stored.reused).toBe(true);
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  /**
   * Un fallo de red o de permisos NO puede confundirse con "no existe": si se
   * tragara, el adaptador reescribiría el objeto (o fallaría más tarde y más
   * lejos) en vez de propagar la causa real.
   */
  it("propagates a stat failure that is not a missing object", async () => {
    mockStatObject.mockRejectedValue(
      Object.assign(new Error("AccessDenied"), { code: "AccessDenied" }),
    );

    await expect(
      adapter.upload(makeInput(), { category: "perfiles", ownerUserId: OWNER }),
    ).rejects.toThrow("AccessDenied");
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("refuses a MIME type it has no extension for, instead of guessing", async () => {
    mockStatObject.mockRejectedValue(notFound());

    await expect(
      adapter.upload(
        makeInput({
          mimeType: "application/octet-stream",
          originalName: "payload.html",
        }),
        { category: "perfiles", ownerUserId: OWNER } satisfies MediaUploadTarget,
      ),
    ).rejects.toMatchObject({ status: 415 });
    expect(mockPutObject).not.toHaveBeenCalled();
  });
});

import { createHash } from "crypto";
import { MediaUploadInput, MediaUploadTarget } from "../media-storage.port";

const mockStatObject = jest.fn();
const mockPutObject = jest.fn();
const mockRemoveObject = jest.fn();

jest.mock("minio", () => ({
  Client: jest.fn().mockImplementation(() => ({
    statObject: mockStatObject,
    putObject: mockPutObject,
    removeObject: mockRemoveObject,
  })),
}));

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

function createAdapter(): MinioStorageAdapter {
  return new MinioStorageAdapter({
    endPoint: "minio",
    port: 9000,
    useSSL: false,
    accessKey: "gymsheet-api",
    secretKey: "a-secret-long-enough-for-the-env-schema",
    bucket: "gymsheet-media",
    region: "us-east-1",
    publicBaseUrl: "https://gymsheet-media.example.ts.net/",
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

  /**
   * LA garantía del ADR-0010 en la capa de código. Las otras dos capas viven en
   * el servidor (credenciales sin `s3:DeleteObject` y bucket versionado), pero
   * ésta es la única que un cambio de código puede tumbar sin querer.
   */
  it("never deletes an object: remove is a no-op", async () => {
    await expect(
      adapter.remove(`users/${OWNER}/stories/abc.jpg`),
    ).resolves.toBeUndefined();

    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it("declares itself immutable so retention does not promise a deletion", () => {
    expect(adapter.immutable).toBe(true);
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

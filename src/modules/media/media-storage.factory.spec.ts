import { LocalStorageAdapter } from "./adapters/local-storage.adapter";
import { MinioStorageAdapter } from "./adapters/minio-storage.adapter";
import { createMediaStorageProvider } from "./media-storage.factory";

describe("createMediaStorageProvider", () => {
  const base = {
    localRoot: "storage/media",
    publicBaseUrl: "http://localhost:3000/media",
  };
  const minioCredentials = {
    endPoint: "minio",
    port: 9000,
    useSSL: false,
    accessKey: "gymsheet-api",
    secretKey: "a-secret-long-enough-for-the-env-schema",
    bucket: "gymsheet-media",
    region: "us-east-1",
  };

  it("returns the local adapter for provider=local", () => {
    const provider = createMediaStorageProvider({ ...base, provider: "local" });
    expect(provider).toBeInstanceOf(LocalStorageAdapter);
    expect(provider.name).toBe("local");
    expect(provider.canRemove("catalog/abc.jpg")).toBe(true);
  });

  it("returns the minio adapter, deleting people's content and keeping the catalog, when configured", () => {
    const provider = createMediaStorageProvider({
      ...base,
      provider: "minio",
      minio: minioCredentials,
    });
    expect(provider).toBeInstanceOf(MinioStorageAdapter);
    expect(provider.name).toBe("minio");
    expect(provider.canRemove("users/u1/stories/abc.jpg")).toBe(true);
    expect(provider.canRemove("catalog/abc.jpg")).toBe(false);
  });

  it("keeps people's content on a minio deployment that declares it not deletable", () => {
    const provider = createMediaStorageProvider({
      ...base,
      provider: "minio",
      minio: { ...minioCredentials, userContentDeletable: false },
    });
    expect(provider.canRemove("users/u1/stories/abc.jpg")).toBe(false);
  });

  /**
   * Sin credenciales el proceso NO debe arrancar: un adaptador a medio
   * configurar serviría subidas que revientan una a una, en vez de fallar una
   * sola vez y de forma legible en el arranque.
   */
  it("refuses to build the minio adapter without credentials, naming what is missing", () => {
    expect(() =>
      createMediaStorageProvider({ ...base, provider: "minio" }),
    ).toThrow(/MINIO_ENDPOINT.*MINIO_ACCESSKEY.*MINIO_SECRETKEY.*MINIO_BUCKET/is);

    expect(() =>
      createMediaStorageProvider({
        ...base,
        provider: "minio",
        minio: { ...minioCredentials, secretKey: undefined },
      }),
    ).toThrow(/MINIO_SECRETKEY/i);
  });

  it("throws (no silent fallback) for unimplemented providers", () => {
    expect(() =>
      createMediaStorageProvider({ ...base, provider: "cloudinary" }),
    ).toThrow(/cloudinary/i);
    expect(() =>
      createMediaStorageProvider({ ...base, provider: "s3" }),
    ).toThrow(/s3/i);
  });
});

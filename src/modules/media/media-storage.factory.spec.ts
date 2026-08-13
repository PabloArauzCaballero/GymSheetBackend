import { LocalStorageAdapter } from "./adapters/local-storage.adapter";
import { createMediaStorageProvider } from "./media-storage.factory";

describe("createMediaStorageProvider", () => {
  const base = {
    localRoot: "storage/media",
    publicBaseUrl: "http://localhost:3000/media",
  };

  it("returns the local adapter for provider=local", () => {
    const provider = createMediaStorageProvider({ ...base, provider: "local" });
    expect(provider).toBeInstanceOf(LocalStorageAdapter);
    expect(provider.name).toBe("local");
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

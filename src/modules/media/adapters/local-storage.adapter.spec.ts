import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MediaUploadInput } from "../media-storage.port";
import { LocalStorageAdapter } from "./local-storage.adapter";

function makeInput(overrides: Partial<MediaUploadInput> = {}): MediaUploadInput {
  return {
    originalName: "cover.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 3,
    buffer: Buffer.from("abc"),
    ...overrides,
  };
}

describe("LocalStorageAdapter", () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "media-adapter-"));
    adapter = new LocalStorageAdapter({
      root,
      publicBaseUrl: "http://localhost:3000/media/",
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes the file named by its sha256 and returns a servable URL", async () => {
    const input = makeInput();
    const sha = createHash("sha256").update(input.buffer).digest("hex");

    const stored = await adapter.upload(input);

    expect(stored.provider).toBe("local");
    expect(stored.checksumSha256).toBe(sha);
    expect(stored.key).toBe(`${sha}.jpg`);
    // trailing slash in base URL must be normalized to a single separator
    expect(stored.url).toBe(`http://localhost:3000/media/${sha}.jpg`);
    expect(stored.reused).toBe(false);
    expect(existsSync(join(root, `${sha}.jpg`))).toBe(true);
    expect(readFileSync(join(root, `${sha}.jpg`)).toString()).toBe("abc");
  });

  it("is idempotent by content: re-uploading the same bytes reuses the asset", async () => {
    const first = await adapter.upload(makeInput());
    const second = await adapter.upload(makeInput());

    expect(first.key).toBe(second.key);
    expect(first.url).toBe(second.url);
    expect(second.reused).toBe(true);
  });

  it("derives the extension from MIME, falling back to the original name", async () => {
    const png = await adapter.upload(
      makeInput({ mimeType: "image/png", buffer: Buffer.from("png-bytes") }),
    );
    expect(png.key.endsWith(".png")).toBe(true);

    const unknown = await adapter.upload(
      makeInput({
        mimeType: "application/octet-stream",
        originalName: "notes.bin",
        buffer: Buffer.from("bin"),
      }),
    );
    expect(unknown.key.endsWith(".bin")).toBe(true);
  });

  it("removes a stored asset by key", async () => {
    const stored = await adapter.upload(makeInput());
    expect(existsSync(join(root, stored.key))).toBe(true);

    await adapter.remove(stored.key);
    expect(existsSync(join(root, stored.key))).toBe(false);

    // removing a missing key is a no-op, not an error
    await expect(adapter.remove(stored.key)).resolves.toBeUndefined();
  });
});

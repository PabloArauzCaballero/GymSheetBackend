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

  it("derives the extension from the declared MIME type only", async () => {
    const png = await adapter.upload(
      makeInput({ mimeType: "image/png", buffer: Buffer.from("png-bytes") }),
    );
    expect(png.key.endsWith(".png")).toBe(true);

    const quicktime = await adapter.upload(
      makeInput({
        mimeType: "video/quicktime",
        originalName: "clip.mov",
        buffer: Buffer.from("mov-bytes"),
      }),
    );
    expect(quicktime.key.endsWith(".mov")).toBe(true);
  });

  /**
   * Regresión de H-01 (XSS almacenado).
   *
   * `video/quicktime` está permitido por defecto en `CHAT_MEDIA_ALLOWED_MIME`
   * pero no estaba en el mapa de extensiones, así que el adaptador caía al
   * nombre que enviaba el cliente: un adjunto llamado `payload.html` se
   * escribía como `<sha>.html` y `express.static` lo servía como `text/html`
   * desde el propio origen de la API. La extensión ahora sale SÓLO del MIME.
   */
  it("never takes the extension from the client-supplied file name", async () => {
    for (const originalName of [
      "payload.html",
      "payload.svg",
      "payload.js",
      "payload.xhtml",
    ]) {
      const stored = await adapter.upload(
        makeInput({
          mimeType: "video/quicktime",
          originalName,
          buffer: Buffer.from(`bytes-for-${originalName}`),
        }),
      );

      expect(stored.key.endsWith(".mov")).toBe(true);
      expect(stored.url.endsWith(".mov")).toBe(true);
    }
  });

  it("refuses a MIME type it has no extension for, instead of guessing", async () => {
    // Un tipo permitido en la allowlist pero no mapeado aquí es un fallo de
    // configuración: debe fallar de forma visible, no resolverse con el nombre.
    await expect(
      adapter.upload(
        makeInput({
          mimeType: "application/octet-stream",
          originalName: "notes.bin",
          buffer: Buffer.from("bin"),
        }),
      ),
    ).rejects.toMatchObject({ status: 415 });
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

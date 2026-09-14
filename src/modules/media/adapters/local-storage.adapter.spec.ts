import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MediaUploadInput, MediaUploadTarget } from "../media-storage.port";
import { LocalStorageAdapter } from "./local-storage.adapter";

const OWNER = "11111111-1111-4111-8111-111111111111";
const TARGET: MediaUploadTarget = {
  category: "perfiles",
  ownerUserId: OWNER,
};

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

  it("writes the file under its owner's folder, named by its sha256", async () => {
    const input = makeInput();
    const sha = createHash("sha256").update(input.buffer).digest("hex");
    const key = `users/${OWNER}/perfiles/${sha}.jpg`;

    const stored = await adapter.upload(input, TARGET);

    expect(stored.provider).toBe("local");
    expect(stored.checksumSha256).toBe(sha);
    expect(stored.key).toBe(key);
    // trailing slash in base URL must be normalized to a single separator
    expect(stored.url).toBe(`http://localhost:3000/media/${key}`);
    expect(stored.reused).toBe(false);
    expect(existsSync(join(root, key))).toBe(true);
    expect(readFileSync(join(root, key)).toString()).toBe("abc");
  });

  /**
   * El layout de carpetas es el requisito de producto ("ordenadas por perfil de
   * usuario"), así que se comprueba entero y no solo la carpeta de perfiles.
   */
  it("puts each category in its own folder under the owner", async () => {
    const cases: ReadonlyArray<[MediaUploadTarget, string]> = [
      [{ category: "perfiles", ownerUserId: OWNER }, `users/${OWNER}/perfiles`],
      [{ category: "stories", ownerUserId: OWNER }, `users/${OWNER}/stories`],
      [
        { category: "publicaciones", ownerUserId: OWNER },
        `users/${OWNER}/publicaciones`,
      ],
      [
        { category: "chats", ownerUserId: OWNER, conversationId: "conv-7" },
        `users/${OWNER}/chats/conv-7`,
      ],
      [{ category: "catalog" }, "catalog"],
    ];

    for (const [target, expectedPrefix] of cases) {
      const stored = await adapter.upload(
        makeInput({ buffer: Buffer.from(`bytes-${expectedPrefix}`) }),
        target,
      );
      expect(stored.key.startsWith(`${expectedPrefix}/`)).toBe(true);
    }
  });

  /**
   * La deduplicación por contenido ya NO cruza usuarios: la carpeta es del
   * dueño, así que el mismo binario subido por dos socios son dos objetos. Es
   * lo que hace que borrar lo de uno no pueda romper lo del otro.
   */
  it("does not share a key between two owners with identical bytes", async () => {
    const other = "22222222-2222-4222-8222-222222222222";

    const mine = await adapter.upload(makeInput(), TARGET);
    const theirs = await adapter.upload(makeInput(), {
      category: "perfiles",
      ownerUserId: other,
    });

    expect(mine.key).not.toBe(theirs.key);
    expect(mine.checksumSha256).toBe(theirs.checksumSha256);
    expect(theirs.reused).toBe(false);
  });

  it("is idempotent by content: re-uploading the same bytes reuses the asset", async () => {
    const first = await adapter.upload(makeInput(), TARGET);
    const second = await adapter.upload(makeInput(), TARGET);

    expect(first.key).toBe(second.key);
    expect(first.url).toBe(second.url);
    expect(second.reused).toBe(true);
  });

  it("derives the extension from the declared MIME type only", async () => {
    const png = await adapter.upload(
      makeInput({ mimeType: "image/png", buffer: Buffer.from("png-bytes") }),
      TARGET,
    );
    expect(png.key.endsWith(".png")).toBe(true);

    const quicktime = await adapter.upload(
      makeInput({
        mimeType: "video/quicktime",
        originalName: "clip.mov",
        buffer: Buffer.from("mov-bytes"),
      }),
      TARGET,
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
        TARGET,
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
        TARGET,
      ),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("removes a stored asset by key", async () => {
    const stored = await adapter.upload(makeInput(), TARGET);
    expect(existsSync(join(root, stored.key))).toBe(true);

    await adapter.remove(stored.key);
    expect(existsSync(join(root, stored.key))).toBe(false);

    // removing a missing key is a no-op, not an error
    await expect(adapter.remove(stored.key)).resolves.toBeUndefined();
  });

  /**
   * Las claves ahora llevan barras y llegan desde la base de datos, así que una
   * fila corrompida podría apuntar un `unlink` fuera del almacén. Debe fallar
   * de forma visible, no borrar.
   */
  it("refuses a key that escapes the media root", async () => {
    await expect(adapter.remove("../../etc/passwd")).rejects.toThrow(
      /fuera de la raíz/i,
    );
  });
});

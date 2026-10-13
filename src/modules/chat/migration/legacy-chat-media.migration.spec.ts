import { ChatMediaCipher } from "../chat-media-cipher";
import {
  migrateLegacyChatMedia,
  LegacyChatMediaReference,
  ChatMediaMigrationStore,
} from "./legacy-chat-media.migration";

const cipher = new ChatMediaCipher("offline-test-key-for-chat-media-migration");
const original = Buffer.from("historical private photo");
const reference: LegacyChatMediaReference = {
  id: "message-1",
  senderId: "owner-1",
  conversationId: "conversation-1",
  mediaProvider: "minio",
  mediaKey: "users/owner-1/chats/conversation-1/legacy.jpg",
  mediaUrl:
    "https://public.example/users/owner-1/chats/conversation-1/legacy.jpg",
  mediaMimeType: "image/jpeg",
  mediaSizeBytes: original.length,
};

function fixture() {
  const objects = new Map<string, Buffer>([[reference.mediaKey, original]]);
  let current = { ...reference };
  let corruptWrites = false;
  let conflict = false;
  const store: ChatMediaMigrationStore = {
    async read(key) {
      return objects.get(key) ?? null;
    },
    async writeIfAbsent(key, bytes) {
      if (!objects.has(key))
        objects.set(key, corruptWrites ? Buffer.from("corrupt") : bytes);
    },
    async compareAndSwap(expected, replacement) {
      if (
        conflict ||
        current.mediaKey !== expected.mediaKey ||
        current.mediaUrl !== expected.mediaUrl
      )
        return false;
      current = { ...current, ...replacement };
      return true;
    },
  };
  return {
    objects,
    store,
    get current() {
      return current;
    },
    set corrupt(value: boolean) {
      corruptWrites = value;
    },
    set conflict(value: boolean) {
      conflict = value;
    },
  };
}

describe("legacy chat media migration", () => {
  it.each(["perfiles", "stories", "publicaciones"])(
    "blocks nested public-policy overlap %s before any storage operation in dry-run and apply",
    async (category) => {
      const overlapping = {
        ...reference,
        mediaKey: `users/owner-1/chats/conversation-1/${category}/old.jpg`,
      };
      const store: ChatMediaMigrationStore = {
        async read() {
          throw new Error("unexpected read");
        },
        async writeIfAbsent() {
          throw new Error("unexpected write");
        },
        async compareAndSwap() {
          throw new Error("unexpected CAS");
        },
      };
      for (const options of [
        {},
        { apply: true, sourceEncoding: "plaintext" as const },
      ]) {
        await expect(
          migrateLegacyChatMedia(overlapping, store, cipher, options),
        ).resolves.toEqual({
          status: "public-policy-overlap",
          key: overlapping.mediaKey,
        });
      }
    },
  );

  it("defaults to a dry run without writing objects or changing references", async () => {
    const f = fixture();
    const result = await migrateLegacyChatMedia(reference, f.store, cipher);
    expect(result.status).toBe("planned");
    expect(f.objects.size).toBe(1);
    expect(f.current).toEqual(reference);
  });

  it("requires explicit source classification before applying to a headerless legacy object", async () => {
    const f = fixture();
    await expect(
      migrateLegacyChatMedia(reference, f.store, cipher, { apply: true }),
    ).rejects.toThrow("clasificación");
    expect(f.current).toEqual(reference);
    expect(f.objects.size).toBe(1);
  });

  it("verifies ciphertext before replacing the public reference and preserves the original object", async () => {
    const f = fixture();
    const result = await migrateLegacyChatMedia(reference, f.store, cipher, {
      apply: true,
      sourceEncoding: "plaintext",
    });
    expect(result.status).toBe("migrated");
    expect(f.current.mediaKey).not.toBe(reference.mediaKey);
    expect(f.current.mediaUrl).toBeNull();
    expect(cipher.decrypt(f.objects.get(f.current.mediaKey)!)).toEqual(
      original,
    );
    expect(f.objects.get(reference.mediaKey)).toEqual(original);
    expect(f.objects.size).toBe(2);
  });

  it("retries without producing extra objects or encrypting ciphertext twice", async () => {
    const f = fixture();
    await migrateLegacyChatMedia(reference, f.store, cipher, {
      apply: true,
      sourceEncoding: "plaintext",
    });
    const key = f.current.mediaKey;
    const encrypted = f.objects.get(key);
    const result = await migrateLegacyChatMedia(f.current, f.store, cipher, {
      apply: true,
    });
    expect(result.status).toBe("already-encrypted");
    expect(f.objects.size).toBe(2);
    expect(f.objects.get(key)).toEqual(encrypted);
  });

  it("does not change the reference if the destination cannot be authenticated and verified", async () => {
    const f = fixture();
    f.corrupt = true;
    await expect(
      migrateLegacyChatMedia(reference, f.store, cipher, {
        apply: true,
        sourceEncoding: "plaintext",
      }),
    ).rejects.toThrow();
    expect(f.current).toEqual(reference);
    expect(f.objects.get(reference.mediaKey)).toEqual(original);
  });

  it("reuses a verified candidate after an interrupted reference update", async () => {
    const f = fixture();
    f.conflict = true;
    await expect(
      migrateLegacyChatMedia(reference, f.store, cipher, {
        apply: true,
        sourceEncoding: "plaintext",
      }),
    ).rejects.toThrow("referencia");
    const encrypted = Array.from(f.objects.values())[1];
    f.conflict = false;
    await migrateLegacyChatMedia(reference, f.store, cipher, {
      apply: true,
      sourceEncoding: "plaintext",
    });
    expect(f.objects.size).toBe(2);
    expect(f.objects.get(f.current.mediaKey)).toBe(encrypted);
  });

  it("fails closed on corrupt encrypted source bytes", async () => {
    const f = fixture();
    const corrupt = cipher.encrypt(original);
    corrupt[corrupt.length - 1] ^= 0xff;
    f.objects.set(reference.mediaKey, corrupt);
    await expect(
      migrateLegacyChatMedia(reference, f.store, cipher, {
        apply: true,
        sourceEncoding: "plaintext",
      }),
    ).rejects.toThrow();
    expect(f.objects.size).toBe(1);
    expect(f.current).toEqual(reference);
  });

  it("requires authentication for a classified encrypted source even if its header was damaged", async () => {
    const f = fixture();
    const corrupt = cipher.encrypt(original);
    corrupt[0] ^= 0xff;
    f.objects.set(reference.mediaKey, corrupt);
    await expect(
      migrateLegacyChatMedia(reference, f.store, cipher, {
        apply: true,
        sourceEncoding: "gscm1",
      }),
    ).rejects.toThrow();
    expect(f.objects.size).toBe(1);
    expect(f.current).toEqual(reference);
  });

  it.each([
    { mediaProvider: "local" },
    { mediaKey: "users/another-owner/chats/conversation-1/legacy.jpg" },
    { mediaKey: "users/owner-1/chats/conversation-1/../secret.jpg" },
    { senderId: "owner-1/../another" },
  ])(
    "rejects references outside their declared owner and conversation: %j",
    async (change) => {
      const f = fixture();
      await expect(
        migrateLegacyChatMedia({ ...reference, ...change }, f.store, cipher, {
          apply: true,
        }),
      ).rejects.toThrow();
      expect(f.objects.size).toBe(1);
      expect(f.current).toEqual(reference);
    },
  );
});

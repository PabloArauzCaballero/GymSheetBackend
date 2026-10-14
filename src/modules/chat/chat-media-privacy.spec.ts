import { NotFoundException } from "@nestjs/common";
import { ChatMediaCipher } from "./chat-media-cipher";
import { mapMessageToResponse } from "./chat.mapper";
import { ChatService } from "./chat.service";
import { MessageModel } from "./message.model";

const cipher = new ChatMediaCipher("chat-media-privacy-local-test-key");
const bytes = Buffer.from("private media bytes");
const publicUrl = "https://public-minio.example/users/a/chats/c/historical.jpg";
const message = {
  id: "m",
  conversationId: "c",
  senderId: "a",
  type: "image",
  body: null,
  mediaProvider: "minio",
  mediaKey: "users/a/chats/c/historical.jpg",
  mediaUrl: publicUrl,
  mediaMimeType: "image/jpeg",
  viewOnce: false,
  viewedAt: null,
  locationLat: null,
  locationLng: null,
  createdAt: new Date(),
} as MessageModel;

function fixture(payload = cipher.encrypt(bytes)) {
  let active = true;
  let readCount = 0;
  let duringRead: () => void = () => {};
  const repository = {
    async getParticipant(conversationId: string, userId: string) {
      return active &&
        conversationId === "c" &&
        (userId === "a" || userId === "b")
        ? { conversationId, userId, canWrite: true }
        : null;
    },
    async getMessage() {
      return message;
    },
  };
  const storage = {
    name: "minio",
    async download() {
      readCount++;
      duringRead();
      return payload;
    },
  };
  const parameters = [
    repository,
    {},
    {},
    {},
    {},
    {},
    {},
    storage,
    cipher,
  ] as unknown as ConstructorParameters<typeof ChatService>;
  return {
    service: new ChatService(...parameters),
    get reads() {
      return readCount;
    },
    revoke() {
      active = false;
    },
    revokeDuringRead() {
      duringRead = () => {
        active = false;
      };
    },
  };
}

describe("chat media privacy", () => {
  it("revokes delivery when the connection disappears during the object read", async () => {
    const f = fixture();
    f.revokeDuringRead();
    await expect(f.service.downloadMedia("c", "m", "b")).rejects.toThrow(
      NotFoundException,
    );
    expect(f.reads).toBe(1);
  });

  it("delivers authenticated plaintext for an active member", async () => {
    const f = fixture();
    await expect(f.service.downloadMedia("c", "m", "b")).resolves.toEqual({
      buffer: bytes,
      mimeType: "image/jpeg",
    });
  });

  it("rejects a stranger without reading the object", async () => {
    const f = fixture();
    await expect(f.service.downloadMedia("c", "m", "stranger")).rejects.toThrow(
      NotFoundException,
    );
    expect(f.reads).toBe(0);
  });

  it("rejects a revoked member without reading the object", async () => {
    const f = fixture();
    f.revoke();
    await expect(f.service.downloadMedia("c", "m", "b")).rejects.toThrow(
      NotFoundException,
    );
    expect(f.reads).toBe(0);
  });

  it("does not deliver historical plaintext or redirect to its public URL", async () => {
    const f = fixture(bytes);
    await expect(f.service.downloadMedia("c", "m", "b")).rejects.toThrow(
      NotFoundException,
    );
    const result = mapMessageToResponse(message);
    expect(result.mediaUrl).toBe("/me/conversations/c/messages/m/media");
    expect(JSON.stringify(result)).not.toContain(publicUrl);
  });

  it("does not expose the public URL for legacy references without a storage key", () => {
    expect(
      mapMessageToResponse({ ...message, mediaKey: null } as MessageModel)
        .mediaUrl,
    ).toBeNull();
  });
});

import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../../config/env";

const MAGIC = Buffer.from("GSCM1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Encrypts chat objects so a public storage URL exposes ciphertext only. */
@Injectable()
export class ChatMediaCipher {
  private readonly key: Buffer;

  constructor(secret: string = env.CHAT_MEDIA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET) {
    this.key = createHash("sha256")
      .update("gymsheet:chat-media:v1\0", "utf8")
      .update(secret, "utf8")
      .digest();
  }

  encrypt(plainText: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
  }

  decrypt(payload: Buffer): Buffer {
    const headerSize = MAGIC.length + IV_BYTES + TAG_BYTES;
    if (payload.length < headerSize || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("El archivo de chat no contiene un formato cifrado válido.");
    }
    const ivStart = MAGIC.length;
    const tagStart = ivStart + IV_BYTES;
    const dataStart = tagStart + TAG_BYTES;
    const decipher = createDecipheriv("aes-256-gcm", this.key, payload.subarray(ivStart, tagStart));
    decipher.setAuthTag(payload.subarray(tagStart, dataStart));
    return Buffer.concat([decipher.update(payload.subarray(dataStart)), decipher.final()]);
  }
}

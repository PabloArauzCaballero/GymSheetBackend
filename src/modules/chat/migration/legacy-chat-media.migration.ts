import { createHash } from "crypto";
import { hasChatMediaPublicPolicyOverlap } from "../../media/adapters/minio-public-policy";
import { ChatMediaCipher } from "../chat-media-cipher";

export interface LegacyChatMediaReference {
  readonly id: string;
  readonly senderId: string;
  readonly conversationId: string;
  readonly mediaProvider: string;
  readonly mediaKey: string;
  readonly mediaUrl: string | null;
  readonly mediaMimeType: string;
  readonly mediaSizeBytes: number;
}
export type ChatMediaReplacement = Pick<
  LegacyChatMediaReference,
  "mediaKey" | "mediaUrl" | "mediaSizeBytes"
>;
/** Deliberately no concrete remote adapter or CLI: callers must supply reviewed
 * storage/database adapters. writeIfAbsent MUST be atomic and never overwrite;
 * compareAndSwap MUST match the original row fields in one SQL UPDATE. Neither
 * operation grants read access, modifies an ACL, deletes objects or revives chat.
 */
export interface ChatMediaMigrationStore {
  read(key: string): Promise<Buffer | null>;
  writeIfAbsent(key: string, bytes: Buffer): Promise<void>;
  compareAndSwap(
    expected: LegacyChatMediaReference,
    replacement: ChatMediaReplacement,
  ): Promise<boolean>;
}
export async function migrateLegacyChatMedia(
  reference: LegacyChatMediaReference,
  store: ChatMediaMigrationStore,
  cipher: ChatMediaCipher,
  options: { apply?: boolean; sourceEncoding?: "plaintext" | "gscm1" } = {},
): Promise<{
  status:
    | "planned"
    | "migrated"
    | "already-encrypted"
    | "public-policy-overlap";
  key: string;
}> {
  const segment = /^[a-zA-Z0-9_-]+$/;
  const prefix = `users/${reference.senderId}/chats/${reference.conversationId}/`;
  if (
    reference.mediaProvider !== "minio" ||
    !segment.test(reference.senderId) ||
    !segment.test(reference.conversationId) ||
    !reference.mediaKey.startsWith(prefix) ||
    reference.mediaKey
      .split("/")
      .some(
        (part) => !part || part === "." || part === ".." || part.includes("\\"),
      )
  ) {
    throw new Error("Referencia de chat fuera del destino permitido.");
  }
  // A nested public category can match another Allow because S3 '*' spans '/'.
  // Classification is a blocked outcome, never a successful migration, and
  // happens before reading/writing bytes or updating database references.
  if (hasChatMediaPublicPolicyOverlap(reference.mediaKey)) {
    return { status: "public-policy-overlap", key: reference.mediaKey };
  }
  const source = await store.read(reference.mediaKey);
  if (!source?.length) throw new Error("Objeto de chat no encontrado.");

  // Existing GSCM1 ciphertext is authenticated; corrupt ciphertext never becomes
  // a new plaintext upload. Migrated keys must also decrypt even if their magic
  // header was damaged. No plaintext fallback is introduced in the delivery API.
  const encryptedSource =
    source.subarray(0, 5).equals(Buffer.from("GSCM1", "ascii")) ||
    reference.mediaKey.startsWith(`${prefix}migrated-v1/`) ||
    options.sourceEncoding === "gscm1";
  if (
    options.apply === true &&
    !encryptedSource &&
    options.sourceEncoding !== "plaintext"
  ) {
    throw new Error(
      "Se requiere clasificación explícita de la fuente histórica.",
    );
  }
  const plain = encryptedSource ? cipher.decrypt(source) : source;
  const sha = createHash("sha256").update(plain).digest("hex");
  const key = encryptedSource
    ? reference.mediaKey
    : `${prefix}migrated-v1/${sha}.bin`;
  if (options.apply !== true) return { status: "planned", key };

  if (!encryptedSource) {
    // Stable key + atomic write-if-absent makes retries safe despite random GCM
    // nonces. Reuse only after authenticating and comparing the actual bytes.
    await store.writeIfAbsent(key, cipher.encrypt(plain));
  }
  const candidate = await store.read(key);
  if (!candidate || !cipher.decrypt(candidate).equals(plain)) {
    throw new Error("El destino cifrado no supera la verificación.");
  }
  if (
    key !== reference.mediaKey ||
    reference.mediaUrl !== null ||
    reference.mediaSizeBytes !== candidate.length
  ) {
    const changed = await store.compareAndSwap(reference, {
      mediaKey: key,
      mediaUrl: null,
      mediaSizeBytes: candidate.length,
    });
    if (!changed)
      throw new Error(
        "La referencia cambió durante la migración; volver a inventariar.",
      );
  }
  return { status: encryptedSource ? "already-encrypted" : "migrated", key };
}

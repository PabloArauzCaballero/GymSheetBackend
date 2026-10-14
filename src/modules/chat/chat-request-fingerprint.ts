import { createHash } from "node:crypto";
import type { MessageCreateFields } from "./chat.repository";

/** Fixed, versioned tuple: null, empty text and zero remain distinct. */
export function chatRequestFingerprint(fields: MessageCreateFields): string {
  if (fields.storyId) {
    const canonical = JSON.stringify([2, fields.type, fields.body ?? null, fields.locationLat ?? null, fields.locationLng ?? null, fields.storyId]);
    return `v2:${createHash("sha256").update("gymsheet:chat:request:v2\0").update(canonical).digest("hex")}`;
  }
  const canonical = JSON.stringify([1, fields.type, fields.body ?? null, fields.locationLat ?? null, fields.locationLng ?? null]);
  return `v1:${createHash("sha256").update("gymsheet:chat:request:v1\0").update(canonical).digest("hex")}`;
}

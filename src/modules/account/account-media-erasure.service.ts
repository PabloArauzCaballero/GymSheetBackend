import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { MediaRetentionService } from "../media/media-retention.service";

const payloadSchema = z.object({ storageKeys: z.array(z.string().min(1).max(1024)).max(500) }).strict();

/**
 * Worker side of the closure: removes the files of a closed account. The rows
 * are already gone (closure transaction), so each key only goes through the
 * shared-reference check; a file another account still uses is kept.
 * Idempotent: a retried job finds missing files and moves on.
 */
@Injectable()
export class AccountMediaErasureService {
  constructor(private readonly retention: MediaRetentionService) {}

  async erase(payload: unknown): Promise<{ removed: number; kept: number }> {
    const { storageKeys } = payloadSchema.parse(payload);
    let removed = 0;
    for (const key of storageKeys) {
      const result = await this.retention.deleteRowAndUnreferencedFile(key, () => Promise.resolve());
      if (result.fileRemoved) removed += 1;
    }
    return { removed, kept: storageKeys.length - removed };
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
import { MediaReleaseService } from "../media/media-release.service";
import { ChatMessageEvidence, ModerationSafeguardsRepository } from "./moderation-safeguards.repository";

/** How long a reported chat message copy is kept after its last report is closed. */
export const CHAT_EVIDENCE_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60_000;
const PURGE_BATCH_SIZE = 200;

/**
 * Evidence copy of reported chat messages.
 *
 * The copy is taken in the report transaction, so the sender's "delete for
 * everyone" (which empties the message row) or the disappearing-message purge
 * no longer destroys what moderation has to review. It is plain text like the
 * message itself; an attached file stays the same encrypted object, whose
 * release is held while a copy points to it and requested here when the copy
 * goes.
 *
 * The purge runs in the API process on an `unref` timer, like the disappearing
 * chat purge; tests call `purgeExpired(now)` with a fixed clock.
 */
@Injectable()
export class ModerationEvidenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationEvidenceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: ModerationSafeguardsRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  onModuleInit(): void {
    if (env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.purgeExpired(new Date()).catch((error: unknown) => {
      this.logger.warn({ event: "moderation.evidence_purge_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
    }), PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  captureChatMessage(messageId: string, transaction: Transaction): Promise<void> {
    return this.repository.captureChatMessage(messageId, transaction);
  }

  findChatMessage(messageId: string): Promise<ChatMessageEvidence | null> {
    return this.repository.findChatMessageEvidence(messageId);
  }

  /** Deletes every copy whose reports were all closed more than the retention ago. */
  async purgeExpired(now: Date): Promise<number> {
    const resolvedBefore = new Date(now.getTime() - CHAT_EVIDENCE_RETENTION_DAYS * DAY_MS);
    let total = 0;
    for (;;) {
      const deleted = await this.sequelize.transaction(async (transaction) => {
        const result = await this.repository.deleteExpiredChatEvidence(resolvedBefore, PURGE_BATCH_SIZE, transaction);
        for (const media of result.orphanMedia) {
          await this.mediaRelease.requestRelease(
            { aggregateType: "moderation.chat_evidence", aggregateId: media.messageId, provider: media.provider, storageKey: media.storageKey },
            transaction,
          );
        }
        return result.deleted;
      });
      total += deleted;
      if (deleted < PURGE_BATCH_SIZE) break;
    }
    if (total > 0) this.logger.log({ event: "moderation.evidence_purged", deleted: total });
    return total;
  }
}

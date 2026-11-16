import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaReleaseService } from "../media/media-release.service";
import { ChatRepository, PurgedChatMedia } from "./chat.repository";

const PURGE_INTERVAL_MS = 5 * 60_000;
const PURGE_BATCH_SIZE = 500;

/**
 * Borra los mensajes temporales caducados. La lectura ya los oculta desde su
 * `expires_at` (desaparecen para ambos al momento); esta pasada es la higiene
 * que evita que la tabla crezca con filas que nadie puede ver.
 *
 * Corre dentro del proceso de la API con un temporizador `unref`: no necesita
 * un contenedor propio, y con varias instancias el `DELETE` es idempotente.
 * En pruebas no arranca solo; los e2e llaman a `purgeOnce` directamente.
 *
 * The encrypted file of a purged message is released on the `media.release`
 * queue in the same transaction as the DELETE, unless another row (or the
 * moderation evidence copy of a reported message) still points to it.
 */
@Injectable()
export class ChatDisappearingPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatDisappearingPurgeService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: ChatRepository,
    private readonly sequelize: Sequelize,
    private readonly references: MediaReferencesRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  onModuleInit(): void {
    if (env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.purgeOnce(), PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Una pasada: drena lotes mientras vengan llenos. Nunca lanza. */
  async purgeOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let total = 0;
    try {
      for (;;) {
        const deleted = await this.sequelize.transaction(async (transaction) => {
          const purged = await this.repository.purgeExpiredMessages(PURGE_BATCH_SIZE, transaction);
          for (const message of purged) await this.releaseFile(message, transaction);
          return purged.length;
        });
        total += deleted;
        if (deleted < PURGE_BATCH_SIZE) break;
      }
      if (total > 0) this.logger.log({ event: "chat.disappearing_purge.completed", deleted: total });
    } catch (error: unknown) {
      this.logger.warn({
        event: "chat.disappearing_purge.failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      this.running = false;
    }
    return total;
  }

  private async releaseFile(message: PurgedChatMedia, transaction: Transaction): Promise<void> {
    if (!message.mediaKey || !message.mediaProvider) return;
    if (await this.references.isReferenced(message.mediaKey, transaction)) return;
    await this.mediaRelease.requestRelease(
      { aggregateType: "chat.message", aggregateId: message.id, provider: message.mediaProvider, storageKey: message.mediaKey },
      transaction,
    );
  }
}

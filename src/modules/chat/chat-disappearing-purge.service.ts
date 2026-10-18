import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { env } from "../../config/env";
import { ChatRepository } from "./chat.repository";

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
 */
@Injectable()
export class ChatDisappearingPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatDisappearingPurgeService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly repository: ChatRepository) {}

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
        const deleted = await this.repository.purgeExpiredMessages(PURGE_BATCH_SIZE);
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
}

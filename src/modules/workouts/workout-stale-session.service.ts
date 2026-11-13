import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { env } from "../../config/env";
import { WorkoutsRepository } from "./workouts.repository";

const SWEEP_INTERVAL_MS = 30 * 60_000;
/** Pasadas estas horas una sesión abierta ya no es «la de ahora». */
export const STALE_OPEN_SESSION_HOURS = 12;

/**
 * Cierra (cancela) las sesiones de entreno que se quedaron abiertas. Mismo
 * patrón que la purga del chat: temporizador `unref` dentro de la API, sin
 * contenedor propio, idempotente con varias instancias y apagado en pruebas.
 */
@Injectable()
export class WorkoutStaleSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkoutStaleSessionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly repository: WorkoutsRepository) {}

  onModuleInit(): void {
    if (env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.sweepOnce(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Una pasada. Nunca lanza. */
  async sweepOnce(now: number = Date.now()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const cutoff = new Date(now - STALE_OPEN_SESSION_HOURS * 3_600_000);
      const closed = await this.repository.cancelStaleOpenSessions(cutoff);
      if (closed > 0) this.logger.log({ event: "workouts.stale_sessions.cancelled", closed });
      return closed;
    } catch (error: unknown) {
      this.logger.warn({
        event: "workouts.stale_sessions.failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return 0;
    } finally {
      this.running = false;
    }
  }
}

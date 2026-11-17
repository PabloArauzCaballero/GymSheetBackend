import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { OrderMaintenanceService } from "../modules/business-orders/order-maintenance.service";
import { sleep } from "./worker-loop";

/**
 * `worker:orders-maintenance` (ADR-0024): expires unpaid orders past their
 * deadline (their stock goes back), cancels the unpaid orders of a seller
 * that is no longer public, and reminds the business of receipts waiting for
 * its decision. Same contract as the other runners: honours the bootstrap's
 * AbortSignal, an isolated failure never kills the process, structured logs.
 */
@Injectable()
export class OrdersMaintenanceRunner {
  private readonly logger = new Logger(OrdersMaintenanceRunner.name);

  constructor(private readonly maintenance: OrderMaintenanceService) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({ event: "worker.started", worker: "orders-maintenance" });
    while (!signal.aborted) {
      try {
        const result = await this.maintenance.runOnce();
        const moved = result.expired + result.cancelled + result.reminded;
        if (moved > 0 || result.failed > 0) this.logger.log({ event: "orders_maintenance.pass_completed", ...result });
        // A full batch with progress means a backlog: keep draining without waiting.
        if (moved >= env.ORDERS_MAINTENANCE_BATCH_SIZE) continue;
      } catch (error: unknown) {
        this.logger.error({
          event: "orders_maintenance.pass_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        });
      }
      await sleep(env.ORDERS_MAINTENANCE_INTERVAL_MS, signal);
    }
    this.logger.log({ event: "worker.stopped", worker: "orders-maintenance" });
  }
}

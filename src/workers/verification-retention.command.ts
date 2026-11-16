import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VerificationRetentionService } from "../modules/verification/verification-retention.service";
import { VerificationMaintenanceModule } from "./verification-maintenance.module";

/**
 * Retention of person-verification selfies. One-shot, like
 * `db:signups:retention`, so an external scheduler runs it (daily is enough):
 *  - closes challenges left unanswered for 24 h (EXPIRED);
 *  - erases the selfie of EXPIRED attempts immediately and of decided ones
 *    30 days after the decision. Rows keep status and dates, never the image.
 *
 *   yarn db:verification:retention
 */
async function run(): Promise<void> {
  const application = await NestFactory.createApplicationContext(VerificationMaintenanceModule, {
    logger: ["error", "warn", "log"],
  });

  try {
    const result = await application.get(VerificationRetentionService).purge(new Date());
    Logger.log({ event: "verification_retention.completed", ...result }, "VerificationRetention");
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  Logger.error(
    {
      event: "verification_retention.failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    },
    error instanceof Error ? error.stack : undefined,
    "VerificationRetention",
  );
  process.exitCode = 1;
});

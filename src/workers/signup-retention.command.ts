import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SignupRetentionService } from '../modules/antibot/signup-retention.service';
import { SignupMaintenanceModule } from './signup-maintenance.module';

/**
 * Retention of the signup anti-bot tables (ADR-0013). One-shot, like
 * `db:outbox:prune`, so an external scheduler runs it (daily is enough):
 *  - deletes spent form tickets / attestation nonces older than 1 day;
 *  - nulls `ip_hmac` on signup audits older than 90 days (the verdict stays).
 * Unlike the outbox prune it has no dry run: it only removes data the
 * retention policy already says must not be kept.
 *
 *   yarn db:signups:retention
 */
async function run(): Promise<void> {
  const application = await NestFactory.createApplicationContext(SignupMaintenanceModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const result = await application.get(SignupRetentionService).purge(new Date());
    Logger.log({ event: 'signup_retention.completed', ...result }, 'SignupRetention');
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  Logger.error(
    {
      event: 'signup_retention.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
    'SignupRetention',
  );
  process.exitCode = 1;
});

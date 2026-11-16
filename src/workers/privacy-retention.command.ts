import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrivacyRetentionService } from '../modules/privacy/privacy-retention.service';
import { PrivacyMaintenanceModule } from './privacy-maintenance.module';

/**
 * Personal-data retention (ADR-0013, ADR-0014). One-shot, like
 * `db:outbox:prune`, so an external scheduler runs it (daily is enough):
 *  - deletes spent form tickets / attestation nonces older than 1 day;
 *  - nulls every keyed IP hash older than 90 days (signup audit, legal
 *    acceptances, devices, password resets, admin audit, coach downloads);
 *  - deletes ban-evasion records of closed accounts whose strikes expired (ADR-0015).
 * It has no dry run: it only removes data the retention policy says must not
 * be kept. The log carries counts only, never a value.
 *
 *   yarn db:privacy:retention   (alias: yarn db:signups:retention)
 */
async function run(): Promise<void> {
  const application = await NestFactory.createApplicationContext(PrivacyMaintenanceModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const result = await application.get(PrivacyRetentionService).purge(new Date());
    Logger.log({ event: 'privacy_retention.completed', ...result }, 'PrivacyRetention');
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  Logger.error(
    {
      event: 'privacy_retention.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
    'PrivacyRetention',
  );
  process.exitCode = 1;
});

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrivacyRetentionService } from '../modules/privacy/privacy-retention.service';
import { PrivacyMaintenanceModule } from './privacy-maintenance.module';

/**
 * Personal-data retention (ADR-0013, ADR-0014). One-shot, like
 * `db:outbox:prune`; the `privacy-retention` worker runs the same pass daily:
 *  - deletes spent form tickets / attestation nonces older than 1 day;
 *  - nulls every keyed IP hash older than 90 days (signup audit, legal
 *    acceptances, devices, password resets, admin audit, coach downloads);
 *  - deletes ban-evasion records of closed accounts whose strikes expired (ADR-0015);
 *  - erases content a closure kept because it was reported, 180 days after its last report closed;
 *  - closes selfie challenges left unanswered for 24 h and erases verification selfies (EXPIRED
 *    attempts at once, decided ones 30 days after the decision) through `media.release`.
 * It has no dry run: it only removes data the retention policy says must not
 * be kept. The log carries counts only, never a value.
 *
 *   yarn db:privacy:retention   (aliases: yarn db:signups:retention, yarn db:verification:retention)
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

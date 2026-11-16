import { Injectable } from "@nestjs/common";
import type { Transaction } from "sequelize";
import { ConsentsService } from "../consents/consents.service";

/** DI token of the consent check bound by `VerificationModule`. */
export const VERIFICATION_CONSENT_PORT = Symbol("VERIFICATION_CONSENT_PORT");

/**
 * Whether the member granted the VERIFICATION_SELFIE consent (biometric data).
 * Implementations throw the HTTP error the client must see when it is missing.
 * With `transaction` the check holds a lock until it ends, so a concurrent
 * revocation waits for the write and then erases what it stored.
 */
export interface VerificationConsentPort {
  assertGranted(userId: string, transaction?: Transaction): Promise<void>;
}

/**
 * Adapter over the consent ledger (`src/modules/consents`): 400
 * CONSENT_REQUIRED `{ kind: "VERIFICATION_SELFIE" }` unless the member has an
 * open grant of the current text version.
 */
@Injectable()
export class LedgerVerificationConsent implements VerificationConsentPort {
  constructor(private readonly consents: ConsentsService) {}

  assertGranted(userId: string, transaction?: Transaction): Promise<void> {
    return this.consents.assertCurrentGranted(userId, "VERIFICATION_SELFIE", transaction);
  }
}

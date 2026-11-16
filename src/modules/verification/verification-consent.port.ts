import { Injectable } from "@nestjs/common";

/** DI token of the consent check bound by `VerificationModule`. */
export const VERIFICATION_CONSENT_PORT = Symbol("VERIFICATION_CONSENT_PORT");

/**
 * Whether the member granted the VERIFICATION_SELFIE consent (biometric data).
 * Implementations throw the HTTP error the client must see when it is missing.
 */
export interface VerificationConsentPort {
  assertGranted(userId: string): Promise<void>;
}

/**
 * TEMPORARY default: allows everyone. The consent ledger
 * (`src/modules/consents`, PUT /me/consents/:kind) lives in another branch;
 * when it is merged, bind `VERIFICATION_CONSENT_PORT` to an adapter over that
 * ledger for kind VERIFICATION_SELFIE and delete this class.
 */
@Injectable()
export class AllowAllVerificationConsent implements VerificationConsentPort {
  async assertGranted(_userId: string): Promise<void> {
    return undefined;
  }
}

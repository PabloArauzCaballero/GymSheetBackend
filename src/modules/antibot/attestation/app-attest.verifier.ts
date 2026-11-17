import type { AttestationOutcome } from "./play-integrity.verifier";

/**
 * iOS App Attest is NOT verified server-side yet (ADR-0013). A correct check
 * needs CBOR decoding of the attestation object, the X.509 chain up to Apple's
 * App Attest root, the nonce extension, rpIdHash, and a per-device key store
 * for later assertions; that does not fit this layer safely. Until it exists
 * iOS attestation is a risk signal only and this always answers UNSUPPORTED,
 * so no iOS signup is ever rejected on the strength of an unchecked token.
 */
export class AppAttestVerifier {
  verify(_attestation: string, _expectedNonce: string): Promise<AttestationOutcome> {
    return Promise.resolve("UNSUPPORTED");
  }
}

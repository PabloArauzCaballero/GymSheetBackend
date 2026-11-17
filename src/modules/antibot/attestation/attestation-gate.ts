import { Inject, Injectable } from "@nestjs/common";
import { ANTIBOT_CONFIG, AntibotConfig } from "../antibot.config";
import { PLAY_INTEGRITY_VERIFIER } from "../antibot.tokens";
import { RiskReason, RiskReasonCode } from "../risk-score";
import type { SignupAttestation, SignupChannel } from "../signup-protection.types";
import { AppAttestVerifier } from "./app-attest.verifier";
import { AttestationChallengeService } from "./attestation-challenge.service";
import type { PlayIntegrityVerifier } from "./play-integrity.verifier";

/** "REJECT", a soft risk reason, or null when the app proved itself. */
export type AttestationAssessment = "REJECT" | RiskReasonCode | null;

/**
 * Layer 4: mobile app attestation. Enforced only for Android with
 * ATTESTATION_ENABLED; iOS stays a risk signal until App Attest is verified
 * server-side (see AppAttestVerifier). Web signups are not concerned.
 */
@Injectable()
export class AttestationGate {
  constructor(
    @Inject(ANTIBOT_CONFIG) private readonly config: AntibotConfig,
    @Inject(PLAY_INTEGRITY_VERIFIER) private readonly playIntegrity: PlayIntegrityVerifier | null,
    private readonly challenges: AttestationChallengeService,
    private readonly appAttest: AppAttestVerifier,
  ) {}

  async assess(channel: SignupChannel, attestation: SignupAttestation | null): Promise<AttestationAssessment> {
    if (channel !== "IOS" && channel !== "ANDROID") return null;
    const enforced = channel === "ANDROID" && this.config.attestationEnabled && this.playIntegrity !== null;
    if (!attestation) return enforced ? "REJECT" : RiskReason.ATTESTATION_MISSING;

    const expectedPlatform = channel === "ANDROID" ? "android" : "ios";
    const nonceValid = attestation.platform === expectedPlatform && (await this.challenges.consume(attestation.nonce));
    if (!nonceValid) return enforced ? "REJECT" : RiskReason.ATTESTATION_UNVERIFIED;

    const verifier = channel === "ANDROID" ? this.playIntegrity : this.appAttest;
    if (!verifier) return RiskReason.ATTESTATION_UNVERIFIED;
    const outcome = await verifier.verify(attestation.token, attestation.nonce);
    if (outcome === "PASSED") return null;
    if (outcome === "UNAVAILABLE") return RiskReason.ATTESTATION_UNAVAILABLE;
    if (outcome === "FAILED" && enforced) return "REJECT";
    return RiskReason.ATTESTATION_UNVERIFIED;
  }
}

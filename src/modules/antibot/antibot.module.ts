import { Module } from "@nestjs/common";
import { AntibotController } from "./antibot.controller";
import {
  ANTIBOT_CLOCK,
  ANTIBOT_CONFIG,
  ANTIBOT_FETCH,
  AntibotClock,
  AntibotConfig,
  antibotConfigFromEnv,
  AntibotFetch,
} from "./antibot.config";
import { AntibotPersistenceModule } from "./antibot-persistence.module";
import { DISPOSABLE_DOMAINS, PLAY_INTEGRITY_VERIFIER } from "./antibot.tokens";
import { AppAttestVerifier } from "./attestation/app-attest.verifier";
import { AttestationChallengeService } from "./attestation/attestation-challenge.service";
import { AttestationGate } from "./attestation/attestation-gate";
import { GoogleAccessTokenProvider } from "./attestation/google-access-token";
import { PlayIntegrityVerifier } from "./attestation/play-integrity.verifier";
import { BreachedPasswordChecker } from "./breached-password.checker";
import { bundledDisposableDomains } from "./disposable-email";
import { FormTicketService } from "./form-ticket.service";
import { SignupAdminController } from "./signup-admin.controller";
import { SignupModerationService } from "./signup-moderation.service";
import { SignupProtectionService } from "./signup-protection.service";
import { SignupRateLimiter } from "./signup-rate-limiter";
import { TurnstileVerifier } from "./turnstile.verifier";

/** Built only when enforcement is on; the env schema guarantees its credentials then. */
function playIntegrityFactory(config: AntibotConfig, fetcher: AntibotFetch, clock: AntibotClock) {
  if (!config.attestationEnabled || !config.playIntegrityPackageName || !config.playIntegrityServiceAccountJson) {
    return null;
  }
  const tokens = new GoogleAccessTokenProvider(config.playIntegrityServiceAccountJson, fetcher, clock, config.httpTimeoutMs);
  return new PlayIntegrityVerifier(config.playIntegrityPackageName, tokens, fetcher, clock, config.httpTimeoutMs);
}

/** Signup anti-automation layer (ADR-0013). Auth consumes `SignupProtectionService`. */
@Module({
  imports: [AntibotPersistenceModule],
  controllers: [AntibotController, SignupAdminController],
  providers: [
    { provide: ANTIBOT_CONFIG, useFactory: antibotConfigFromEnv },
    { provide: ANTIBOT_CLOCK, useValue: (() => new Date()) satisfies AntibotClock },
    { provide: ANTIBOT_FETCH, useValue: ((input, init) => fetch(input, init)) satisfies AntibotFetch },
    { provide: DISPOSABLE_DOMAINS, useFactory: bundledDisposableDomains },
    {
      provide: PLAY_INTEGRITY_VERIFIER,
      useFactory: playIntegrityFactory,
      inject: [ANTIBOT_CONFIG, ANTIBOT_FETCH, ANTIBOT_CLOCK],
    },
    AppAttestVerifier,
    AttestationChallengeService,
    AttestationGate,
    BreachedPasswordChecker,
    FormTicketService,
    SignupRateLimiter,
    TurnstileVerifier,
    SignupModerationService,
    SignupProtectionService,
  ],
  exports: [SignupProtectionService],
})
export class AntibotModule {}

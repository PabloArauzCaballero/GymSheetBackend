import { Controller, Get, Header } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/decorators/public.decorator";
import { env } from "../../config/env";
import { AttestationChallengeService } from "./attestation/attestation-challenge.service";
import { FormTicketService } from "./form-ticket.service";

const issueThrottleOptions = {
  default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl: env.RATE_LIMIT_TTL_SECONDS * 1000 },
};

/** Public issuers of the single-use values a signup must carry (ADR-0013). */
@Controller("auth")
export class AntibotController {
  constructor(
    private readonly tickets: FormTicketService,
    private readonly challenges: AttestationChallengeService,
  ) {}

  /** Form ticket: fetch when the signup form opens, send back as `ticket` in the register body. */
  @Public()
  @Throttle(issueThrottleOptions)
  @Header("Cache-Control", "no-store")
  @Get("register/ticket")
  issueTicket() {
    return this.tickets.issue();
  }

  /** Nonce the mobile app binds into its Play Integrity / App Attest request. */
  @Public()
  @Throttle(issueThrottleOptions)
  @Header("Cache-Control", "no-store")
  @Get("attestation/challenge")
  issueChallenge() {
    return this.challenges.issue();
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ANTIBOT_CLOCK, ANTIBOT_CONFIG, AntibotClock, AntibotConfig } from "../antibot.config";
import { readNonce, signNonce } from "../signed-token";
import { TicketLedgerRepository } from "../ticket-ledger.repository";

export const ATTESTATION_NONCE_TTL_MS = 10 * 60 * 1000;

/**
 * Issues the nonce the mobile app binds into its Play Integrity / App Attest
 * request, and spends it on first use. Stateless until spent, like form tickets.
 */
@Injectable()
export class AttestationChallengeService {
  constructor(
    @Inject(ANTIBOT_CONFIG) private readonly config: AntibotConfig,
    @Inject(ANTIBOT_CLOCK) private readonly clock: AntibotClock,
    private readonly ledger: TicketLedgerRepository,
  ) {}

  issue(): { nonce: string } {
    return { nonce: signNonce(this.config.ticketSecret, { id: randomUUID(), issuedAt: this.clock() }) };
  }

  /** True only for an authentic, fresh nonce that had not been used before (and now is). */
  async consume(nonce: string): Promise<boolean> {
    const claims = readNonce(this.config.ticketSecret, nonce);
    if (!claims) return false;
    const now = this.clock();
    const age = now.getTime() - claims.issuedAt.getTime();
    if (age < 0 || age > ATTESTATION_NONCE_TTL_MS) return false;
    return this.ledger.spend(claims.id, "ATTESTATION", claims.issuedAt, now);
  }
}

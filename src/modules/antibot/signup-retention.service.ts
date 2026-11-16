import { Injectable } from "@nestjs/common";
import { SignupAuditRepository } from "./signup-audit.repository";
import { TicketLedgerRepository } from "./ticket-ledger.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spent tokens expire within an hour; a day keeps them for incident review. */
export const SPENT_TOKEN_RETENTION_DAYS = 1;
/** After this the verdict stays, but "same address" can no longer be correlated. */
export const IP_HASH_RETENTION_DAYS = 90;

export type SignupRetentionResult = { ticketsDeleted: number; ipHashesCleared: number };

/** Layer 12: data minimisation of the anti-bot tables. */
@Injectable()
export class SignupRetentionService {
  constructor(
    private readonly ledger: TicketLedgerRepository,
    private readonly audits: SignupAuditRepository,
  ) {}

  async purge(now: Date): Promise<SignupRetentionResult> {
    const ticketsDeleted = await this.ledger.deleteUsedBefore(
      new Date(now.getTime() - SPENT_TOKEN_RETENTION_DAYS * DAY_MS),
    );
    const ipHashesCleared = await this.audits.clearIpHashesBefore(
      new Date(now.getTime() - IP_HASH_RETENTION_DAYS * DAY_MS),
    );
    return { ticketsDeleted, ipHashesCleared };
  }
}

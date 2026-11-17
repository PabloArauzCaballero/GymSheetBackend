import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ANTIBOT_CLOCK, ANTIBOT_CONFIG, AntibotClock, AntibotConfig } from "./antibot.config";
import { readTicket, signTicket } from "./signed-token";
import type { SignupRejectReason } from "./signup-protection.types";
import { TicketLedgerRepository } from "./ticket-ledger.repository";

export const FORM_TICKET_TTL_MS = 60 * 60 * 1000;

export type IssuedTicket = { ticket: string; issuedAt: string };

export type TicketCheck =
  | { ok: true; ticketId: string; issuedAt: Date; durationMs: number }
  | {
      ok: false;
      reason: Extract<SignupRejectReason, "TICKET_MISSING" | "TICKET_INVALID" | "TICKET_REUSED" | "TOO_FAST">;
      ticketId: string | null;
      issuedAt: Date | null;
      durationMs: number | null;
    };

/**
 * Layer 1: signed, single-use form ticket. The server measures the time from
 * issue to submit, so a script that posts the form without ever loading it,
 * or faster than a person can type, is told apart without any third party.
 */
@Injectable()
export class FormTicketService {
  constructor(
    @Inject(ANTIBOT_CONFIG) private readonly config: AntibotConfig,
    @Inject(ANTIBOT_CLOCK) private readonly clock: AntibotClock,
    private readonly ledger: TicketLedgerRepository,
  ) {}

  issue(): IssuedTicket {
    const issuedAt = this.clock();
    return {
      ticket: signTicket(this.config.ticketSecret, { id: randomUUID(), issuedAt }),
      issuedAt: issuedAt.toISOString(),
    };
  }

  /** Read-only check; spending the ticket is the caller's decision. */
  async check(ticket: string | null): Promise<TicketCheck> {
    if (!ticket) return { ok: false, reason: "TICKET_MISSING", ticketId: null, issuedAt: null, durationMs: null };
    const claims = readTicket(this.config.ticketSecret, ticket);
    const now = this.clock().getTime();
    const age = claims ? now - claims.issuedAt.getTime() : null;
    // A ticket "from the future" is as forged as one with a bad signature.
    if (!claims || age === null || age < 0 || age > FORM_TICKET_TTL_MS) {
      return { ok: false, reason: "TICKET_INVALID", ticketId: null, issuedAt: null, durationMs: null };
    }
    const known = { ticketId: claims.id, issuedAt: claims.issuedAt, durationMs: age };
    if (await this.ledger.isSpent(claims.id)) return { ok: false, reason: "TICKET_REUSED", ...known };
    if (age < this.config.minFillMs) return { ok: false, reason: "TOO_FAST", ...known };
    return { ok: true, ...known };
  }
}

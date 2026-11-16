import { Injectable } from "@nestjs/common";
import { IP_HASH_RETENTION_DAYS } from "../../common/privacy/client-ip-hash";
import { env } from "../../config/env";
import { TicketLedgerRepository } from "../antibot/ticket-ledger.repository";
import { IpHmacTable, PrivacyRetentionRepository } from "./privacy-retention.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spent anti-bot tokens expire within an hour; a day keeps them for incident review. */
export const SPENT_TOKEN_RETENTION_DAYS = 1;

export type PrivacyRetentionResult = {
  ticketsDeleted: number;
  /** Hashes nulled per table; their total is `ipHashesCleared`. */
  ipHashesClearedByTable: Record<IpHmacTable, number>;
  ipHashesCleared: number;
  rawIpsConverted: number;
};

/** Data minimisation across every table holding personal data with a retention limit (ADR-0014). */
@Injectable()
export class PrivacyRetentionService {
  constructor(
    private readonly ledger: TicketLedgerRepository,
    private readonly repository: PrivacyRetentionRepository,
  ) {}

  async purge(now: Date, ipHashSecret: string | undefined = env.IP_HASH_SECRET): Promise<PrivacyRetentionResult> {
    const rawIpsConverted = await this.repository.convertRawDownloadAuditIps(ipHashSecret);
    const ticketsDeleted = await this.ledger.deleteUsedBefore(
      new Date(now.getTime() - SPENT_TOKEN_RETENTION_DAYS * DAY_MS),
    );
    const ipHashesClearedByTable = await this.repository.clearIpHashesBefore(
      new Date(now.getTime() - IP_HASH_RETENTION_DAYS * DAY_MS),
    );
    const ipHashesCleared = Object.values(ipHashesClearedByTable).reduce((total, count) => total + count, 0);
    return { ticketsDeleted, ipHashesClearedByTable, ipHashesCleared, rawIpsConverted };
  }
}

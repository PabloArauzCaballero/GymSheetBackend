import { Injectable } from "@nestjs/common";
import { IP_HASH_RETENTION_DAYS } from "../../common/privacy/client-ip-hash";
import { ReportedContentRetentionService } from "../account/reported-content-retention.service";
import { TicketLedgerRepository } from "../antibot/ticket-ledger.repository";
import { KycRetentionResult, KycRetentionService } from "../business-kyc/kyc-retention.service";
import { VerificationRetentionResult, VerificationRetentionService } from "../verification/verification-retention.service";
import { IpHmacTable, PrivacyRetentionRepository } from "./privacy-retention.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spent anti-bot tokens expire within an hour; a day keeps them for incident review. */
export const SPENT_TOKEN_RETENTION_DAYS = 1;

export type PrivacyRetentionResult = {
  ticketsDeleted: number;
  /** Hashes nulled per table; their total is `ipHashesCleared`. */
  ipHashesClearedByTable: Record<IpHmacTable, number>;
  ipHashesCleared: number;
  closedAccountSanctionsDeleted: number;
  /** Content kept at closure because it was reported, erased per target kind (reports closed 180+ days ago). */
  reportedContentErased: Record<string, number>;
  /** Abandoned selfie challenges and overdue reviews closed, selfie files queued for deletion (franja 6). */
  verification: VerificationRetentionResult;
  /** KYC documents, encrypted identity data and phone codes past their period (franja 8b, ADR-0021). */
  kyc: KycRetentionResult;
};

/** Data minimisation across every table holding personal data with a retention limit (ADR-0014). */
@Injectable()
export class PrivacyRetentionService {
  constructor(
    private readonly ledger: TicketLedgerRepository,
    private readonly repository: PrivacyRetentionRepository,
    private readonly reportedContent: ReportedContentRetentionService,
    private readonly verification: VerificationRetentionService,
    private readonly kyc: KycRetentionService,
  ) {}

  async purge(now: Date): Promise<PrivacyRetentionResult> {
    const ticketsDeleted = await this.ledger.deleteUsedBefore(
      new Date(now.getTime() - SPENT_TOKEN_RETENTION_DAYS * DAY_MS),
    );
    const ipHashesClearedByTable = await this.repository.clearIpHashesBefore(
      new Date(now.getTime() - IP_HASH_RETENTION_DAYS * DAY_MS),
    );
    const ipHashesCleared = Object.values(ipHashesClearedByTable).reduce((total, count) => total + count, 0);
    const closedAccountSanctionsDeleted = await this.repository.deleteExpiredClosedAccountSanctions(now);
    const reportedContentErased = await this.reportedContent.purge(now);
    const verification = await this.verification.purge(now);
    const kyc = await this.kyc.purge(now);
    return {
      ticketsDeleted,
      ipHashesClearedByTable,
      ipHashesCleared,
      closedAccountSanctionsDeleted,
      reportedContentErased,
      verification,
      kyc,
    };
  }
}

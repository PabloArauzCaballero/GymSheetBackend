import type { ReportedContentRetentionService } from "../account/reported-content-retention.service";
import type { TicketLedgerRepository } from "../antibot/ticket-ledger.repository";
import type { VerificationRetentionService } from "../verification/verification-retention.service";
import { IP_HMAC_COLUMNS, type PrivacyRetentionRepository } from "./privacy-retention.repository";
import { PrivacyRetentionService } from "./privacy-retention.service";

describe("PrivacyRetentionService", () => {
  it("deletes spent tokens older than 1 day, clears IP hashes older than 90 days, expired closure sanctions, expired reported content and due verification selfies", async () => {
    const ledger = { deleteUsedBefore: jest.fn().mockResolvedValue(4) };
    const cleared = Object.fromEntries(IP_HMAC_COLUMNS.map(({ table }, index) => [table, index + 1]));
    const repository = {
      deleteExpiredClosedAccountSanctions: jest.fn().mockResolvedValue(2),
      clearIpHashesBefore: jest.fn().mockResolvedValue(cleared),
    };
    const reportedContent = { purge: jest.fn().mockResolvedValue({ REEL: 1, COMMENT: 2 }) };
    const verification = { purge: jest.fn().mockResolvedValue({ expiredChallenges: 3, selfiesErased: 5 }) };
    const service = new PrivacyRetentionService(
      ledger as unknown as TicketLedgerRepository,
      repository as unknown as PrivacyRetentionRepository,
      reportedContent as unknown as ReportedContentRetentionService,
      verification as unknown as VerificationRetentionService,
    );

    await expect(service.purge(new Date("2026-11-16T00:00:00.000Z"))).resolves.toEqual({
      ticketsDeleted: 4,
      ipHashesClearedByTable: cleared,
      ipHashesCleared: 21,
      closedAccountSanctionsDeleted: 2,
      reportedContentErased: { REEL: 1, COMMENT: 2 },
      verification: { expiredChallenges: 3, selfiesErased: 5 },
    });
    expect(ledger.deleteUsedBefore).toHaveBeenCalledWith(new Date("2026-11-15T00:00:00.000Z"));
    expect(repository.clearIpHashesBefore).toHaveBeenCalledWith(new Date("2026-08-18T00:00:00.000Z"));
    expect(repository.deleteExpiredClosedAccountSanctions).toHaveBeenCalledWith(new Date("2026-11-16T00:00:00.000Z"));
    expect(reportedContent.purge).toHaveBeenCalledWith(new Date("2026-11-16T00:00:00.000Z"));
    expect(verification.purge).toHaveBeenCalledWith(new Date("2026-11-16T00:00:00.000Z"));
  });

  it("covers every table that stores a keyed IP hash", () => {
    expect(IP_HMAC_COLUMNS.map(({ table, column }) => `${table}.${column}`)).toEqual([
      "auth.signup_audit.ip_hmac",
      "auth.terms_acceptances.ip_hmac",
      "auth.user_devices.last_ip_hmac",
      "public.password_reset_tokens.ip_hmac",
      "admin.audit_log.ip_hmac",
      "training.routine_progress_download_audits.ip_hmac",
    ]);
  });
});

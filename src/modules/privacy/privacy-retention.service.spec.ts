import type { TicketLedgerRepository } from "../antibot/ticket-ledger.repository";
import { IP_HMAC_COLUMNS, type PrivacyRetentionRepository } from "./privacy-retention.repository";
import { PrivacyRetentionService } from "./privacy-retention.service";

describe("PrivacyRetentionService", () => {
  it("deletes spent tokens older than 1 day and clears IP hashes older than 90 days in every table", async () => {
    const ledger = { deleteUsedBefore: jest.fn().mockResolvedValue(4) };
    const cleared = Object.fromEntries(IP_HMAC_COLUMNS.map(({ table }, index) => [table, index + 1]));
    const repository = {
      convertRawDownloadAuditIps: jest.fn().mockResolvedValue(3),
      clearIpHashesBefore: jest.fn().mockResolvedValue(cleared),
    };
    const service = new PrivacyRetentionService(
      ledger as unknown as TicketLedgerRepository,
      repository as unknown as PrivacyRetentionRepository,
    );

    await expect(service.purge(new Date("2026-11-16T00:00:00.000Z"), "s".repeat(32))).resolves.toEqual({
      ticketsDeleted: 4,
      ipHashesClearedByTable: cleared,
      ipHashesCleared: 21,
      rawIpsConverted: 3,
    });
    expect(ledger.deleteUsedBefore).toHaveBeenCalledWith(new Date("2026-11-15T00:00:00.000Z"));
    expect(repository.clearIpHashesBefore).toHaveBeenCalledWith(new Date("2026-08-18T00:00:00.000Z"));
    expect(repository.convertRawDownloadAuditIps).toHaveBeenCalledWith("s".repeat(32));
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

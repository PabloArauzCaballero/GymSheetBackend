import type { SignupAuditRepository } from "./signup-audit.repository";
import { SignupRetentionService } from "./signup-retention.service";
import type { TicketLedgerRepository } from "./ticket-ledger.repository";

describe("SignupRetentionService", () => {
  it("deletes spent tokens older than 1 day and clears IP hashes older than 90 days", async () => {
    const ledger = { deleteUsedBefore: jest.fn().mockResolvedValue(4) };
    const audits = { clearIpHashesBefore: jest.fn().mockResolvedValue(2) };
    const service = new SignupRetentionService(
      ledger as unknown as TicketLedgerRepository,
      audits as unknown as SignupAuditRepository,
    );

    await expect(service.purge(new Date("2026-11-16T00:00:00.000Z"))).resolves.toEqual({ ticketsDeleted: 4, ipHashesCleared: 2 });
    expect(ledger.deleteUsedBefore).toHaveBeenCalledWith(new Date("2026-11-15T00:00:00.000Z"));
    expect(audits.clearIpHashesBefore).toHaveBeenCalledWith(new Date("2026-08-18T00:00:00.000Z"));
  });
});

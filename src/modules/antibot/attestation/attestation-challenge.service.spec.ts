import { testAntibotConfig } from "../testing/antibot-test-config";
import type { TicketLedgerRepository } from "../ticket-ledger.repository";
import { ATTESTATION_NONCE_TTL_MS, AttestationChallengeService } from "./attestation-challenge.service";

describe("AttestationChallengeService", () => {
  let now: Date;
  const spent = new Set<string>();
  const ledger = {
    spend: jest.fn((id: string) => {
      if (spent.has(id)) return Promise.resolve(false);
      spent.add(id);
      return Promise.resolve(true);
    }),
  } as unknown as TicketLedgerRepository;
  const service = new AttestationChallengeService(testAntibotConfig(), () => now, ledger);

  beforeEach(() => {
    now = new Date("2026-11-16T10:00:00.000Z");
    spent.clear();
  });

  it("accepts its own fresh nonce exactly once", async () => {
    const { nonce } = service.issue();
    await expect(service.consume(nonce)).resolves.toBe(true);
    await expect(service.consume(nonce)).resolves.toBe(false);
    expect(ledger.spend).toHaveBeenCalledWith(expect.any(String), "ATTESTATION", expect.any(Date), now);
  });

  it("rejects an expired or foreign nonce without touching the ledger", async () => {
    const { nonce } = service.issue();
    now = new Date(now.getTime() + ATTESTATION_NONCE_TTL_MS + 1);
    jest.mocked(ledger.spend).mockClear();
    await expect(service.consume(nonce)).resolves.toBe(false);
    await expect(service.consume("A".repeat(75))).resolves.toBe(false);
    expect(ledger.spend).not.toHaveBeenCalled();
  });
});

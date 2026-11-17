import { FORM_TICKET_TTL_MS, FormTicketService } from "./form-ticket.service";
import { testAntibotConfig } from "./testing/antibot-test-config";
import type { TicketLedgerRepository } from "./ticket-ledger.repository";

describe("FormTicketService", () => {
  let now: Date;
  const spent = new Set<string>();
  const ledger = { isSpent: jest.fn((id: string) => Promise.resolve(spent.has(id))) } as unknown as TicketLedgerRepository;
  const service = new FormTicketService(testAntibotConfig(), () => now, ledger);

  beforeEach(() => {
    now = new Date("2026-11-16T10:00:00.000Z");
    spent.clear();
  });

  const issueAndWait = (elapsedMs: number) => {
    const { ticket } = service.issue();
    now = new Date(now.getTime() + elapsedMs);
    return ticket;
  };

  it("accepts a fresh ticket after the minimum fill time and reports the duration", async () => {
    const result = await service.check(issueAndWait(4000));
    expect(result).toMatchObject({ ok: true, durationMs: 4000, issuedAt: new Date("2026-11-16T10:00:00.000Z") });
  });

  it("reports TICKET_MISSING without a ticket", async () => {
    expect(await service.check(null)).toMatchObject({ ok: false, reason: "TICKET_MISSING" });
  });

  it("reports TOO_FAST under the minimum fill time", async () => {
    expect(await service.check(issueAndWait(2999))).toMatchObject({ ok: false, reason: "TOO_FAST", durationMs: 2999 });
  });

  it("reports TICKET_INVALID once the ticket is older than 60 minutes", async () => {
    expect(await service.check(issueAndWait(FORM_TICKET_TTL_MS + 1))).toMatchObject({ ok: false, reason: "TICKET_INVALID" });
  });

  it("reports TICKET_INVALID for a forged ticket and for one issued in the future", async () => {
    expect(await service.check("eyJpZCI6IngifQ.c2ln")).toMatchObject({ ok: false, reason: "TICKET_INVALID" });
    expect(await service.check(issueAndWait(-1000))).toMatchObject({ ok: false, reason: "TICKET_INVALID" });
  });

  it("reports TICKET_REUSED for a ticket already in the ledger", async () => {
    const ticket = issueAndWait(5000);
    const first = await service.check(ticket);
    if (!first.ok) throw new Error("expected a valid ticket");
    spent.add(first.ticketId);
    expect(await service.check(ticket)).toMatchObject({ ok: false, reason: "TICKET_REUSED" });
  });
});

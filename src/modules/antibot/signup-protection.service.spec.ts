import { ConflictException } from "@nestjs/common";
import type { Transaction } from "sequelize";
import { CounterRegistry } from "../../common/metrics/counter-registry";
import type { AntibotConfig } from "./antibot.config";
import type { AttestationGate } from "./attestation/attestation-gate";
import type { BreachedPasswordChecker } from "./breached-password.checker";
import { FormTicketService } from "./form-ticket.service";
import type { SignupAuditEntry, SignupAuditRepository } from "./signup-audit.repository";
import { SignupProtectionService } from "./signup-protection.service";
import type { SignupContext } from "./signup-protection.types";
import { SignupRateLimiter } from "./signup-rate-limiter";
import { testAntibotConfig } from "./testing/antibot-test-config";
import type { TicketLedgerRepository } from "./ticket-ledger.repository";
import type { TurnstileOutcome, TurnstileVerifier } from "./turnstile.verifier";

type Doubles = { turnstile?: TurnstileOutcome; attestation?: string | null; breach?: string; auditFails?: boolean };

function setup(overrides: Partial<AntibotConfig> = {}, doubles: Doubles = {}) {
  let now = new Date("2026-11-16T10:00:00.000Z");
  const clock = () => now;
  const config = testAntibotConfig(overrides);
  const spent = new Map<string, Transaction | undefined>();
  const ledger = {
    isSpent: (id: string) => Promise.resolve(spent.has(id)),
    spend: jest.fn((id: string, _kind: string, _issued: Date, _used: Date, transaction?: Transaction) => {
      if (spent.has(id)) return Promise.resolve(false);
      spent.set(id, transaction);
      return Promise.resolve(true);
    }),
  };
  const audits: { entry: SignupAuditEntry; transaction?: Transaction }[] = [];
  const auditRepository = {
    record: (entry: SignupAuditEntry, transaction?: Transaction) =>
      doubles.auditFails ? Promise.reject(new Error("db down")) : Promise.resolve(void audits.push({ entry, transaction })),
  };
  const tickets = new FormTicketService(config, clock, ledger as unknown as TicketLedgerRepository);
  const counters = new CounterRegistry();
  const service = new SignupProtectionService(
    config,
    clock,
    new Set(["mailinator.com"]),
    tickets,
    ledger as unknown as TicketLedgerRepository,
    auditRepository as unknown as SignupAuditRepository,
    new SignupRateLimiter(config, clock, null),
    { enabled: config.turnstileSecret !== null, verify: () => Promise.resolve(doubles.turnstile ?? "PASSED") } as unknown as TurnstileVerifier,
    { assess: () => Promise.resolve(doubles.attestation ?? null) } as unknown as AttestationGate,
    { check: () => Promise.resolve(doubles.breach ?? "DISABLED") } as unknown as BreachedPasswordChecker,
    counters,
  );
  const context = (patch: Partial<SignupContext> = {}, elapsedMs = 5000): SignupContext => {
    const { ticket } = tickets.issue();
    now = new Date(now.getTime() + elapsedMs);
    return {
      ticket,
      honeypot: null,
      turnstileToken: "turnstile",
      attestation: null,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15",
      installationId: "install-abc",
      email: "person@example.test",
      password: "a long enough password",
      channel: "WEB",
      ...patch,
    };
  };
  return { service, context, audits, spent, ledger, counters };
}

describe("SignupProtectionService", () => {
  it("allows a clean signup as LOW risk without writing anything yet", async () => {
    const { service, context, audits } = setup();
    const verdict = await service.evaluate(context());
    expect(verdict).toMatchObject({ allowed: true, reason: null, risk: "LOW", riskReasons: [], durationMs: 5000 });
    expect(verdict.ticketId).toEqual(expect.any(String));
    expect(audits).toHaveLength(0);
  });

  it("records the accepted signup and spends the ticket inside the caller's transaction", async () => {
    const { service, context, audits, spent, counters } = setup();
    const verdict = await service.evaluate(context());
    const afterCommit: (() => void)[] = [];
    const transaction = { afterCommit: (callback: () => void) => afterCommit.push(callback) } as unknown as Transaction;

    await service.recordOutcome(verdict, "user-1", transaction);

    expect(spent.get(verdict.ticketId!)).toBe(transaction);
    expect(audits[0].transaction).toBe(transaction);
    expect(audits[0].entry).toMatchObject({ userId: "user-1", rejectReason: null, channel: "WEB", installationId: "install-abc" });
    expect(audits[0].entry.ipHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(counters.render().join("\n")).not.toContain("accepted");
    afterCommit.forEach((callback) => callback());
    expect(counters.render().join("\n")).toContain('outcome="accepted"');
  });

  it("audits a vouched signup (seed or identity provider) without running layers or spending a ticket", async () => {
    const { service, audits, spent } = setup();
    const transaction = { afterCommit: () => undefined } as unknown as Transaction;
    const verdict = service.vouchedVerdict("IDENTITY_GOOGLE", "IOS");

    expect(verdict).toMatchObject({ allowed: true, risk: "LOW", riskReasons: ["IDENTITY_GOOGLE"], ticketId: null });
    await service.recordOutcome(verdict, "user-9", transaction);

    expect(spent.size).toBe(0);
    expect(audits[0].entry).toMatchObject({ userId: "user-9", channel: "IOS", rejectReason: null, ipHmac: null });
  });

  it("lets only one of two racing submits with the same ticket create an account", async () => {
    const { service, context } = setup();
    const ctx = context();
    const first = await service.evaluate(ctx);
    const second = await service.evaluate(ctx);
    await service.recordOutcome(first, "user-1");
    await expect(service.recordOutcome(second, "user-2")).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ["TICKET_MISSING", { ticket: null }],
    ["TICKET_INVALID", { ticket: "forged.ticket" }],
    ["HONEYPOT", { honeypot: "http://spam.example" }],
    ["DISPOSABLE_EMAIL", { email: "bot@inbox.mailinator.com" }],
  ] as const)("rejects %s and audits it without a user", async (reason, patch) => {
    const { service, context, audits } = setup();
    const verdict = await service.evaluate(context(patch));
    expect(verdict).toMatchObject({ allowed: false, reason });
    expect(audits[0].entry).toMatchObject({ userId: null, rejectReason: reason });
  });

  it("rejects a submit faster than the minimum fill time and burns its ticket", async () => {
    const { service, context, spent } = setup();
    const verdict = await service.evaluate(context({}, 1200));
    expect(verdict).toMatchObject({ allowed: false, reason: "TOO_FAST", durationMs: 1200 });
    expect(spent.has(verdict.ticketId!)).toBe(true);
  });

  it("rejects a reused ticket", async () => {
    const { service, context } = setup();
    const ctx = context();
    await service.recordOutcome(await service.evaluate(ctx), "user-1");
    await expect(service.evaluate(ctx)).resolves.toMatchObject({ allowed: false, reason: "TICKET_REUSED" });
  });

  it("rejects the sixth signup from one IP within the hour", async () => {
    const { service, context } = setup();
    for (let index = 0; index < 5; index += 1) await service.evaluate(context({ installationId: null }));
    await expect(service.evaluate(context({ installationId: null }))).resolves.toMatchObject({ reason: "RATE_LIMITED" });
  });

  it("raises IP velocity from the third signup of the hour", async () => {
    const { service, context } = setup();
    await service.evaluate(context({ installationId: null }));
    await service.evaluate(context({ installationId: null }));
    await expect(service.evaluate(context({ installationId: null }))).resolves.toMatchObject({ allowed: true, riskReasons: ["IP_VELOCITY"] });
  });

  it("rejects a failed Turnstile on web and treats an outage per TURNSTILE_FAIL_CLOSED", async () => {
    const on = { turnstileSecret: "secret" };
    const failed = setup(on, { turnstile: "FAILED" });
    await expect(failed.service.evaluate(failed.context())).resolves.toMatchObject({ reason: "TURNSTILE_FAILED" });
    const open = setup(on, { turnstile: "UNAVAILABLE" });
    await expect(open.service.evaluate(open.context())).resolves.toMatchObject({ allowed: true, risk: "MEDIUM", riskReasons: ["TURNSTILE_UNAVAILABLE"] });
    const closed = setup({ ...on, turnstileFailClosed: true }, { turnstile: "UNAVAILABLE" });
    await expect(closed.service.evaluate(closed.context())).resolves.toMatchObject({ reason: "TURNSTILE_FAILED" });
    const mobile = setup(on, { turnstile: "FAILED" });
    await expect(mobile.service.evaluate(mobile.context({ channel: "ANDROID" }))).resolves.toMatchObject({ allowed: true });
  });

  it("maps an attestation rejection to ATTESTATION_FAILED and soft results to risk", async () => {
    const rejected = setup({}, { attestation: "REJECT" });
    await expect(rejected.service.evaluate(rejected.context({ channel: "ANDROID" }))).resolves.toMatchObject({ reason: "ATTESTATION_FAILED" });
    const soft = setup({}, { attestation: "ATTESTATION_MISSING", breach: "BREACHED" });
    await expect(soft.service.evaluate(soft.context({ channel: "IOS" }))).resolves.toMatchObject({
      allowed: true,
      risk: "HIGH",
      riskReasons: ["ATTESTATION_MISSING", "BREACHED_PASSWORD"],
    });
  });

  it("flags a breached password and an automation user agent without rejecting", async () => {
    const { service, context } = setup({}, { breach: "BREACHED" });
    await expect(service.evaluate(context())).resolves.toMatchObject({ allowed: true, risk: "MEDIUM", riskReasons: ["BREACHED_PASSWORD"] });
    await expect(service.evaluate(context({ userAgent: "python-requests/2.31" }))).resolves.toMatchObject({ risk: "HIGH" });
  });

  it("lets a client without a ticket through, flagged, while SIGNUP_TICKET_REQUIRED=false", async () => {
    const { service, context, ledger } = setup({ ticketRequired: false });
    const verdict = await service.evaluate(context({ ticket: null }));
    expect(verdict).toMatchObject({ allowed: true, riskReasons: ["TICKET_ABSENT"], ticketId: null });
    await service.recordOutcome(verdict, "user-1");
    expect(ledger.spend).not.toHaveBeenCalled();
  });

  it("still refuses when the audit cannot be written", async () => {
    const { service, context } = setup({}, { auditFails: true });
    await expect(service.evaluate(context({ honeypot: "x" }))).resolves.toMatchObject({ allowed: false, reason: "HONEYPOT" });
  });
});

import { ConflictException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { CounterRegistry } from "../../common/metrics/counter-registry";
import { ANTIBOT_CLOCK, ANTIBOT_CONFIG, AntibotClock, AntibotConfig } from "./antibot.config";
import { AttestationGate } from "./attestation/attestation-gate";
import { BreachedPasswordChecker } from "./breached-password.checker";
import { DISPOSABLE_DOMAINS } from "./antibot.tokens";
import { emailDomainOf, isDisposableDomain } from "./disposable-email";
import { FormTicketService, TicketCheck } from "./form-ticket.service";
import { honeypotTripped } from "./honeypot.check";
import { IP_VELOCITY_SIGNAL, looksAutomated, RiskReason, scoreRisk } from "./risk-score";
import { SignupAuditRepository } from "./signup-audit.repository";
import type { SignupChannel, SignupContext, SignupRejectReason, SignupVerdict } from "./signup-protection.types";
import { SignupRateLimiter } from "./signup-rate-limiter";
import { TicketLedgerRepository } from "./ticket-ledger.repository";
import { TurnstileVerifier } from "./turnstile.verifier";

/** How an account was created without the public form's checks. */
export type VouchedSignupSource = "INTERNAL_SEED" | "IDENTITY_GOOGLE" | "IDENTITY_APPLE";

/** Request facts the audit row needs that the verdict itself does not carry. */
type AuditFacts = { channel: SignupChannel; ipHmac: string | null; installationId: string | null };

/** Control-flow signal of a hard layer; never leaves this service. */
class Rejection extends Error {
  constructor(readonly reason: SignupRejectReason) {
    super(reason);
    this.name = "Rejection";
  }
}

const VERDICTS_METRIC = "gym_sheet_signup_verdicts_total";
const VERDICTS_HELP = "Signup verdicts of the anti-automation layer by outcome, reason and risk.";

/**
 * Decides whether a signup may proceed (ADR-0013). Hard layers reject; soft
 * signals only raise the risk. The reason is logged and audited, never
 * returned to the client, so a bot cannot learn which layer stopped it.
 */
@Injectable()
export class SignupProtectionService {
  private readonly logger = new Logger(SignupProtectionService.name);
  /** Keyed by the verdict object, so `recordOutcome` keeps the contract's signature. */
  private readonly facts = new WeakMap<SignupVerdict, AuditFacts>();

  constructor(
    @Inject(ANTIBOT_CONFIG) private readonly config: AntibotConfig,
    @Inject(ANTIBOT_CLOCK) private readonly clock: AntibotClock,
    @Inject(DISPOSABLE_DOMAINS) private readonly disposableDomains: ReadonlySet<string>,
    private readonly tickets: FormTicketService,
    private readonly ledger: TicketLedgerRepository,
    private readonly audits: SignupAuditRepository,
    private readonly rateLimiter: SignupRateLimiter,
    private readonly turnstile: TurnstileVerifier,
    private readonly attestation: AttestationGate,
    private readonly breaches: BreachedPasswordChecker,
    @Optional() private readonly counters?: CounterRegistry,
  ) {}

  async evaluate(ctx: SignupContext): Promise<SignupVerdict> {
    const facts: AuditFacts = {
      channel: ctx.channel,
      ipHmac: this.ipHmac(ctx.ip),
      installationId: ctx.installationId?.slice(0, 64) || null,
    };
    const reasons: string[] = [];
    const ticket = await this.tickets.check(ctx.ticket);
    try {
      await this.runLayers(ctx, ticket, reasons);
    } catch (error: unknown) {
      if (!(error instanceof Rejection)) throw error;
      const verdict = this.verdict(false, error.reason, ticket, reasons);
      await this.recordRejection(verdict, ticket, facts);
      return verdict;
    }
    const verdict = this.verdict(true, null, ticket, reasons);
    this.facts.set(verdict, facts);
    return verdict;
  }

  /**
   * Verdict for an account that did not come through the public form: an
   * identity provider already proved a real, verified email, or server-side
   * code (seeds) creates it. No layer runs, but the account is still audited,
   * so every account has a signup row saying how it was created.
   */
  vouchedVerdict(source: VouchedSignupSource, channel: SignupChannel): SignupVerdict {
    const verdict: SignupVerdict = {
      allowed: true,
      reason: null,
      risk: "LOW",
      riskReasons: [source],
      startedAt: null,
      durationMs: null,
      ticketId: null,
    };
    this.facts.set(verdict, { channel, ipHmac: null, installationId: null });
    return verdict;
  }

  /**
   * Persists an accepted signup inside the caller's transaction and spends its
   * ticket there, so the account and the "ticket used" mark commit together.
   * Pass the verdict object `evaluate` returned, unchanged.
   */
  async recordOutcome(verdict: SignupVerdict, userId: string, transaction?: Transaction): Promise<void> {
    const facts = this.facts.get(verdict) ?? { channel: "UNKNOWN", ipHmac: null, installationId: null };
    if (verdict.ticketId && verdict.startedAt) {
      const spent = await this.ledger.spend(verdict.ticketId, "FORM", verdict.startedAt, this.clock(), transaction);
      // Two submits raced with the same ticket; only one may create an account.
      if (!spent) throw new ConflictException("No pudimos completar el registro. Vuelve a intentarlo.");
    }
    await this.audits.record({ ...this.auditEntry(verdict, facts), userId }, transaction);
    const emit = () => {
      this.logger.log({ event: "signup.accepted", risk: verdict.risk, riskReasons: verdict.riskReasons, channel: facts.channel });
      this.count("accepted", "NONE", verdict.risk);
    };
    if (transaction) transaction.afterCommit(emit);
    else emit();
  }

  /** Order matters: cheap local checks first, rate limits before any paid or remote call. */
  private async runLayers(ctx: SignupContext, ticket: TicketCheck, reasons: string[]): Promise<void> {
    if (!ticket.ok) {
      if (ticket.reason !== "TICKET_MISSING" || this.config.ticketRequired) throw new Rejection(ticket.reason);
      reasons.push(RiskReason.TICKET_ABSENT);
    }
    if (honeypotTripped(ctx.honeypot)) throw new Rejection("HONEYPOT");
    const domain = emailDomainOf(ctx.email);
    if (isDisposableDomain(domain, this.disposableDomains)) throw new Rejection("DISPOSABLE_EMAIL");

    const limits = await this.rateLimiter.hit({ ip: ctx.ip, installationId: ctx.installationId, emailDomain: domain });
    if (limits.exceeded) throw new Rejection("RATE_LIMITED");
    if (limits.ipCount >= IP_VELOCITY_SIGNAL) reasons.push(RiskReason.IP_VELOCITY);

    if (this.turnstile.enabled && ctx.channel === "WEB") {
      const outcome = await this.turnstile.verify(ctx.turnstileToken, ctx.ip, ticket.ticketId ?? randomUUID());
      if (outcome === "FAILED") throw new Rejection("TURNSTILE_FAILED");
      if (outcome === "UNAVAILABLE") {
        if (this.config.turnstileFailClosed) throw new Rejection("TURNSTILE_FAILED");
        reasons.push(RiskReason.TURNSTILE_UNAVAILABLE);
      }
    }

    const attestation = await this.attestation.assess(ctx.channel, ctx.attestation);
    if (attestation === "REJECT") throw new Rejection("ATTESTATION_FAILED");
    if (attestation !== null) reasons.push(attestation);

    if ((await this.breaches.check(ctx.password)) === "BREACHED") reasons.push(RiskReason.BREACHED_PASSWORD);
    if (looksAutomated(ctx.userAgent)) reasons.push(RiskReason.AUTOMATION_USER_AGENT);
  }

  private verdict(
    allowed: boolean,
    reason: SignupRejectReason | null,
    ticket: TicketCheck,
    reasons: string[],
  ): SignupVerdict {
    const riskReasons = [...new Set(reasons)];
    return {
      allowed,
      reason,
      risk: scoreRisk(riskReasons),
      riskReasons,
      startedAt: ticket.issuedAt,
      durationMs: ticket.durationMs,
      ticketId: ticket.ticketId,
    };
  }

  /**
   * Audits the rejection and burns a ticket that was still unused, so a bot
   * cannot retry the same ticket after learning nothing. A storage failure is
   * logged, not thrown: the person is refused either way, and turning that
   * refusal into a 500 would only tell an attacker something changed.
   */
  private async recordRejection(verdict: SignupVerdict, ticket: TicketCheck, facts: AuditFacts): Promise<void> {
    this.logger.warn({ event: "signup.rejected", reason: verdict.reason, risk: verdict.risk, channel: facts.channel });
    this.count("rejected", verdict.reason ?? "NONE", verdict.risk);
    try {
      const unspent = ticket.ok || ticket.reason === "TOO_FAST";
      if (unspent && ticket.ticketId && ticket.issuedAt) {
        await this.ledger.spend(ticket.ticketId, "FORM", ticket.issuedAt, this.clock());
      }
      await this.audits.record({ ...this.auditEntry(verdict, facts), userId: null });
    } catch (error: unknown) {
      this.logger.error({
        event: "signup.audit_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private auditEntry(verdict: SignupVerdict, facts: AuditFacts) {
    return {
      ticketId: verdict.ticketId,
      startedAt: verdict.startedAt,
      completedAt: this.clock(),
      durationMs: verdict.durationMs,
      channel: facts.channel,
      risk: verdict.risk,
      riskReasons: verdict.riskReasons,
      rejectReason: verdict.reason,
      ipHmac: facts.ipHmac,
      installationId: facts.installationId,
    };
  }

  private ipHmac(ip: string | null): string | null {
    if (!ip || !this.config.ipHashSecret) return null;
    return createHmac("sha256", this.config.ipHashSecret).update(ip).digest("hex");
  }

  private count(outcome: string, reason: string, risk: string): void {
    this.counters?.increment(VERDICTS_METRIC, VERDICTS_HELP, { outcome, reason, risk });
  }
}

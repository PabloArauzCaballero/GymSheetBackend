import { Injectable, Logger } from "@nestjs/common";
import { Transaction } from "sequelize";
import { hashEmail } from "../../common/privacy/email-hash";
import { ClosedAccountSanctionsRepository, SanctionSnapshot } from "./closed-account-sanctions.repository";

type Account = { id: string; email: string; tenantId: string | null };

/**
 * Ban evasion through account closure (ADR-0015). Closing an account wipes
 * the email and the suspension; without this, a sanctioned person could close
 * and sign up again with the same address, strikes gone. At closure the
 * strikes still counting and the running suspension are stored under the
 * keyed hash of the email; the next signup with that email inherits them and
 * the record is consumed. A record lives until its last strike stops counting.
 */
@Injectable()
export class ClosedAccountSanctionsService {
  private readonly logger = new Logger(ClosedAccountSanctionsService.name);

  constructor(private readonly repository: ClosedAccountSanctionsRepository) {}

  /** Inside the closure transaction, BEFORE the account row is anonymized. */
  async recordAtClosure(account: Account, transaction: Transaction, now: Date = new Date()): Promise<boolean> {
    const snapshot = await this.repository.activeSanction(account.id, now, transaction);
    if (!snapshot.suspendedUntil && snapshot.strikes.length === 0) return false;
    const emailHmac = hashEmail(account.email);
    if (!emailHmac) {
      // Without the privacy pepper the email cannot be kept even as a hash; the deployment must set it.
      this.logger.warn({ event: "moderation.closed_sanction_not_recorded", userId: account.id, reason: "privacy_pepper_unset" });
      return false;
    }
    await this.repository.insert(emailHmac, snapshot, expiryOf(snapshot), transaction);
    this.logger.log({ event: "moderation.closed_sanction_recorded", userId: account.id, strikeCount: snapshot.strikes.length });
    return true;
  }

  /**
   * Whether the account carries a running suspension or strikes still
   * counting. The email change refuses then: changing the address first and
   * closing afterwards would file the record under an address the person
   * never signs up with again, and the sanction would be lost.
   */
  async hasActiveSanction(userId: string, transaction?: Transaction, now: Date = new Date()): Promise<boolean> {
    const snapshot = await this.repository.activeSanction(userId, now, transaction);
    return snapshot.suspendedUntil !== null || snapshot.strikes.length > 0;
  }

  /**
   * Inside the signup transaction, right after the account row exists.
   * Returns the inherited suspension end, or null when the account starts clean.
   */
  async inheritAtSignup(account: Account, transaction: Transaction, now: Date = new Date()): Promise<Date | null> {
    const emailHmac = hashEmail(account.email);
    if (!emailHmac) return null;
    const records = await this.repository.consume(emailHmac, now, transaction);
    if (records.length === 0) return null;
    const strikes = records.flatMap((record) => record.strikes);
    await this.repository.insertStrikes(account.id, account.tenantId, strikes, transaction);
    const suspendedUntil = latest(records.map((record) => record.suspendedUntil));
    const running = suspendedUntil && suspendedUntil.getTime() > now.getTime() ? suspendedUntil : null;
    if (running) await this.repository.setSuspension(account.id, running, transaction);
    this.logger.log({ event: "moderation.closed_sanction_inherited", userId: account.id, strikeCount: strikes.length });
    return running;
  }
}

/** End of the counting window: the last strike's expiry, or the suspension end if later. */
function expiryOf(snapshot: SanctionSnapshot): Date {
  return latest([snapshot.suspendedUntil, ...snapshot.strikes.map((strike) => new Date(strike.expiresAt))]) ?? new Date();
}

function latest(dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((max, date) => (date && (!max || date > max) ? date : max), null);
}

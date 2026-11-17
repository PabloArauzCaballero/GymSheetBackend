/** DI token of the configured phone OTP sender (ADR-0021). */
export const PHONE_OTP_SENDER = Symbol("PHONE_OTP_SENDER");
/** DI token of the HTTP transport the senders use (global `fetch`; a fake in tests). */
export const PHONE_OTP_FETCH = Symbol("PHONE_OTP_FETCH");
export type PhoneOtpFetch = typeof fetch;

export type PhoneOtpDelivery = { delivered: true } | { delivered: false; reason: "UNAVAILABLE" | "REJECTED" | "FAILED" };

/**
 * Delivers a one-time code to a phone. `available` false means no code can be
 * sent at all (no provider configured): the phone is kept unverified and the
 * KYC goes to REPP review instead of approving on its own.
 */
export interface PhoneOtpSender {
  readonly name: string;
  readonly available: boolean;
  send(phoneE164: string, code: string): Promise<PhoneOtpDelivery>;
}

/** Default: no provider. Never claims a delivery. */
export class DisabledPhoneOtpSender implements PhoneOtpSender {
  readonly name = "disabled";
  readonly available = false;

  send(): Promise<PhoneOtpDelivery> {
    return Promise.resolve({ delivered: false, reason: "UNAVAILABLE" });
  }
}

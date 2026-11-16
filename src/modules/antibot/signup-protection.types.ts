/**
 * Contract between account creation (auth) and the anti-automation layer
 * (antibot). Auth gathers what the request carried, antibot decides; neither
 * reaches into the other's tables.
 */

export type SignupChannel = "WEB" | "IOS" | "ANDROID" | "UNKNOWN";

export interface SignupAttestation {
  platform: "ios" | "android";
  /** Play Integrity token or App Attest assertion, as the client produced it. */
  token: string;
  /** Nonce issued by `GET /auth/attestation/challenge`. */
  nonce: string;
}

export interface SignupContext {
  /** Signed form ticket from `GET /auth/register/ticket`. */
  ticket: string | null;
  /** Hidden honeypot field; humans leave it empty. */
  honeypot: string | null;
  turnstileToken: string | null;
  attestation: SignupAttestation | null;
  ip: string | null;
  userAgent: string | null;
  /** Random per-installation id sent by the client; never a hardware id. */
  installationId: string | null;
  email: string;
  password: string;
  channel: SignupChannel;
}

/** Why a signup was refused. Logged and audited, never shown to the client. */
export type SignupRejectReason =
  | "TICKET_MISSING"
  | "TICKET_INVALID"
  | "TICKET_REUSED"
  | "TOO_FAST"
  | "HONEYPOT"
  | "TURNSTILE_FAILED"
  | "ATTESTATION_FAILED"
  | "RATE_LIMITED"
  | "DISPOSABLE_EMAIL";

export type SignupRisk = "LOW" | "MEDIUM" | "HIGH";

export interface SignupVerdict {
  allowed: boolean;
  reason: SignupRejectReason | null;
  risk: SignupRisk;
  /** Rule codes that raised the risk, e.g. `BREACHED_PASSWORD`, `IP_VELOCITY`. */
  riskReasons: string[];
  /** When the form ticket was issued; null without a valid ticket. */
  startedAt: Date | null;
  /** Server-measured time from ticket issue to submit. */
  durationMs: number | null;
  ticketId: string | null;
}

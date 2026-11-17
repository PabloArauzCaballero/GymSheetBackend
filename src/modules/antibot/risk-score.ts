import type { SignupRisk } from "./signup-protection.types";

/** Soft signals: none rejects on its own, together they mark a signup for review. */
export const RiskReason = {
  BREACHED_PASSWORD: "BREACHED_PASSWORD",
  IP_VELOCITY: "IP_VELOCITY",
  AUTOMATION_USER_AGENT: "AUTOMATION_USER_AGENT",
  TURNSTILE_UNAVAILABLE: "TURNSTILE_UNAVAILABLE",
  ATTESTATION_MISSING: "ATTESTATION_MISSING",
  ATTESTATION_UNVERIFIED: "ATTESTATION_UNVERIFIED",
  ATTESTATION_UNAVAILABLE: "ATTESTATION_UNAVAILABLE",
  TICKET_ABSENT: "TICKET_ABSENT",
} as const;

export type RiskReasonCode = (typeof RiskReason)[keyof typeof RiskReason];

/** IP velocity becomes a signal from this many signups in the hour, below the hard limit. */
export const IP_VELOCITY_SIGNAL = 3;

// Headless browsers, HTTP libraries and CLI tools announce themselves; a real
// app or browser never does. A missing user agent is just as telling. okhttp is
// deliberately absent: it is the HTTP stack of real React Native Android apps.
const AUTOMATION_UA = /headless|phantomjs|puppeteer|playwright|selenium|webdriver|python-requests|python-urllib|aiohttp|httpx|go-http-client|curl\/|wget\/|libwww|scrapy|java\/|node-fetch|axios\/|undici/i;

export function looksAutomated(userAgent: string | null): boolean {
  return !userAgent || userAgent.trim().length === 0 || AUTOMATION_UA.test(userAgent);
}

/** LOW by default, MEDIUM with one soft signal, HIGH with two or more. */
export function scoreRisk(reasons: readonly string[]): SignupRisk {
  const distinct = new Set(reasons).size;
  if (distinct >= 2) return "HIGH";
  return distinct === 1 ? "MEDIUM" : "LOW";
}

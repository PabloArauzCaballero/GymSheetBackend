import { Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { env } from "../../config/env";

/** Runtime settings of the anti-bot layer, injected so tests and e2e can override them. */
export type AntibotConfig = {
  ticketSecret: string;
  ticketRequired: boolean;
  minFillMs: number;
  turnstileSecret: string | null;
  turnstileFailClosed: boolean;
  attestationEnabled: boolean;
  playIntegrityPackageName: string | null;
  playIntegrityServiceAccountJson: string | null;
  limitPerIpHour: number;
  limitPerInstallationDay: number;
  limitPerEmailDomainHour: number;
  emailDomainAllowlist: readonly string[];
  breachCheckEnabled: boolean;
  httpTimeoutMs: number;
  /** Key for `ip_hmac`; null = no IP evidence is stored. */
  ipHashSecret: string | null;
};

export const ANTIBOT_CONFIG = Symbol("ANTIBOT_CONFIG");
/** `() => Date`, injectable so time-based rules are testable. */
export const ANTIBOT_CLOCK = Symbol("ANTIBOT_CLOCK");
/** `typeof fetch`, injectable so outbound verifiers are testable offline. */
export const ANTIBOT_FETCH = Symbol("ANTIBOT_FETCH");

export type AntibotClock = () => Date;
export type AntibotFetch = typeof fetch;

/**
 * Builds the config from the validated environment. Outside production a
 * missing ticket secret is replaced by a random per-process one: tickets then
 * die on restart and are not shared across instances, which is acceptable for
 * development but never for production (the env schema forbids it there).
 */
export function antibotConfigFromEnv(): AntibotConfig {
  let ticketSecret = env.REGISTRATION_TICKET_SECRET;
  if (!ticketSecret) {
    ticketSecret = randomBytes(32).toString("hex");
    Logger.warn(
      {
        event: "antibot.ticket_secret_ephemeral",
        detail: "REGISTRATION_TICKET_SECRET unset; using a per-process secret.",
      },
      "AntibotModule",
    );
  }

  return {
    ticketSecret,
    ticketRequired: env.SIGNUP_TICKET_REQUIRED,
    minFillMs: env.SIGNUP_MIN_FILL_MS,
    turnstileSecret: env.TURNSTILE_SECRET ?? null,
    turnstileFailClosed: env.TURNSTILE_FAIL_CLOSED,
    attestationEnabled: env.ATTESTATION_ENABLED,
    playIntegrityPackageName: env.PLAY_INTEGRITY_PACKAGE_NAME ?? null,
    playIntegrityServiceAccountJson: env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON ?? null,
    limitPerIpHour: env.SIGNUP_LIMIT_PER_IP_HOUR,
    limitPerInstallationDay: env.SIGNUP_LIMIT_PER_INSTALLATION_DAY,
    limitPerEmailDomainHour: env.SIGNUP_LIMIT_PER_EMAIL_DOMAIN_HOUR,
    emailDomainAllowlist: env.SIGNUP_EMAIL_DOMAIN_ALLOWLIST,
    breachCheckEnabled: env.PASSWORD_BREACH_CHECK_ENABLED,
    httpTimeoutMs: env.ANTIBOT_HTTP_TIMEOUT_MS,
    ipHashSecret: env.IP_HASH_SECRET ?? null,
  };
}

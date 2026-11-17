import type { AntibotConfig, AntibotFetch } from "../antibot.config";

/** Test-only fixtures (imported by specs, never by runtime code). */

/** Baseline config for unit specs: every optional layer off, generous limits. */
export function testAntibotConfig(overrides: Partial<AntibotConfig> = {}): AntibotConfig {
  return {
    ticketSecret: "unit-test-ticket-secret-0123456789abcdef",
    ticketRequired: true,
    minFillMs: 3000,
    turnstileSecret: null,
    turnstileFailClosed: false,
    attestationEnabled: false,
    playIntegrityPackageName: null,
    playIntegrityServiceAccountJson: null,
    limitPerIpHour: 5,
    limitPerInstallationDay: 3,
    limitPerEmailDomainHour: 30,
    emailDomainAllowlist: ["gmail.com"],
    breachCheckEnabled: false,
    httpTimeoutMs: 1000,
    ipHashSecret: "unit-test-ip-hash-secret-0123456789abcdef",
    ...overrides,
  };
}

/** A fetch double answering from a queue and recording each call. */
export function queuedFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: AntibotFetch = (input, init) => {
    calls.push({ url: input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url, init });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error("unexpected fetch"));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetcher, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

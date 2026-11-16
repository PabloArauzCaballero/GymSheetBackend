import type { AntibotFetch } from "./antibot.config";

/**
 * SSRF allowlist of the anti-bot layer. Fixed in code, not configurable: every
 * URL this module calls is a constant, so there is no input that could steer
 * it, and an operator has no reason to widen it.
 */
export const ANTIBOT_ALLOWED_HOSTS = [
  "challenges.cloudflare.com",
  "playintegrity.googleapis.com",
  "oauth2.googleapis.com",
  "api.pwnedpasswords.com",
] as const;

/** The provider could not be reached or answered with a server error. */
export class ProviderUnavailableError extends Error {
  constructor(readonly host: string, detail: string) {
    super(`${host}: ${detail}`);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * `fetch` restricted to https + allowlisted host, with no redirects and a hard
 * timeout. Network failures, timeouts and 5xx become ProviderUnavailableError
 * so each caller can choose to fail open or closed.
 */
export async function fetchAllowlisted(
  fetcher: AntibotFetch,
  rawUrl: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const url = new URL(rawUrl);
  const allowed: readonly string[] = ANTIBOT_ALLOWED_HOSTS;
  if (url.protocol !== "https:" || url.username || url.port || !allowed.includes(url.hostname)) {
    throw new Error(`Outbound URL not allowed: ${url.hostname}`);
  }
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error: unknown) {
    throw new ProviderUnavailableError(url.hostname, error instanceof Error ? error.name : "network error");
  }
  if (response.status >= 500) throw new ProviderUnavailableError(url.hostname, `HTTP ${response.status}`);
  return response;
}

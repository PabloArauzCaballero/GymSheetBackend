import { fetchAllowlisted, ProviderUnavailableError } from "./outbound-http";
import { jsonResponse, queuedFetch } from "./testing/antibot-test-config";

describe("fetchAllowlisted", () => {
  it("refuses hosts outside the allowlist, plain http and explicit ports", async () => {
    const { fetcher, calls } = queuedFetch();
    for (const url of [
      "https://evil.example/turnstile",
      "http://challenges.cloudflare.com/x",
      "https://challenges.cloudflare.com:8443/x",
      "https://user@challenges.cloudflare.com/x",
    ]) {
      await expect(fetchAllowlisted(fetcher, url, {}, 1000)).rejects.toThrow("Outbound URL not allowed");
    }
    expect(calls).toHaveLength(0);
  });

  it("forbids redirects and applies a timeout signal", async () => {
    const { fetcher, calls } = queuedFetch(jsonResponse({}));
    await fetchAllowlisted(fetcher, "https://api.pwnedpasswords.com/range/ABCDE", {}, 1000);
    expect(calls[0].init?.redirect).toBe("error");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps network failures and 5xx to ProviderUnavailableError", async () => {
    const { fetcher } = queuedFetch(new TypeError("fetch failed"), jsonResponse({}, 503));
    const url = "https://oauth2.googleapis.com/token";
    await expect(fetchAllowlisted(fetcher, url, {}, 1000)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(fetchAllowlisted(fetcher, url, {}, 1000)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("returns 4xx responses to the caller to judge", async () => {
    const { fetcher } = queuedFetch(jsonResponse({}, 400));
    const response = await fetchAllowlisted(fetcher, "https://oauth2.googleapis.com/token", {}, 1000);
    expect(response.status).toBe(400);
  });
});

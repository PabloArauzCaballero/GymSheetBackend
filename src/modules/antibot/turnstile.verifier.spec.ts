import { jsonResponse, queuedFetch, testAntibotConfig } from "./testing/antibot-test-config";
import { TurnstileVerifier } from "./turnstile.verifier";

const key = "6d1f3c55-0a4e-4f7f-9e55-9a1b2c3d4e5f";

describe("TurnstileVerifier", () => {
  const build = (...responses: (Response | Error)[]) => {
    const fake = queuedFetch(...responses);
    return { ...fake, verifier: new TurnstileVerifier(testAntibotConfig({ turnstileSecret: "turnstile-secret" }), fake.fetcher) };
  };

  it("is disabled without a secret", () => {
    expect(new TurnstileVerifier(testAntibotConfig(), queuedFetch().fetcher).enabled).toBe(false);
  });

  it("posts secret, response, remoteip and idempotency_key to siteverify", async () => {
    const { verifier, calls } = build(jsonResponse({ success: true }));
    await expect(verifier.verify("client-token", "203.0.113.7", key)).resolves.toBe("PASSED");
    expect(calls[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const form = calls[0].init?.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      secret: "turnstile-secret",
      response: "client-token",
      remoteip: "203.0.113.7",
      idempotency_key: key,
    });
  });

  it("fails a rejected or missing token", async () => {
    const { verifier, calls } = build(jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }));
    await expect(verifier.verify("bad", null, key)).resolves.toBe("FAILED");
    await expect(verifier.verify(null, null, key)).resolves.toBe("FAILED");
    expect(calls).toHaveLength(1);
  });

  it("reports UNAVAILABLE when Cloudflare is unreachable, erroring or answers garbage", async () => {
    const { verifier } = build(
      new TypeError("fetch failed"),
      jsonResponse({}, 502),
      jsonResponse({ success: false, "error-codes": ["internal-error"] }),
      new Response("<html>", { status: 200 }),
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(verifier.verify("token", null, key)).resolves.toBe("UNAVAILABLE");
    }
  });
});

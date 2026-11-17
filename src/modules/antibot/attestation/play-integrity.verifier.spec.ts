import { createVerify, generateKeyPairSync } from "node:crypto";
import { jsonResponse, queuedFetch } from "../testing/antibot-test-config";
import { GoogleAccessTokenProvider } from "./google-access-token";
import { PlayIntegrityVerifier } from "./play-integrity.verifier";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = JSON.stringify({
  client_email: "integrity@project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://attacker.example/token",
});
const now = new Date("2026-11-16T10:00:00.000Z");
const clock = () => now;
const packageName = "com.gymsheet.app";
const nonce = "bm9uY2Utb2YtdGhlLXNpZ251cC1mbG93LTEyMzQ1Njc4";

function verdict(overrides: { nonce?: string; app?: string; device?: string[]; pkg?: string; at?: number } = {}) {
  return {
    tokenPayloadExternal: {
      requestDetails: {
        requestPackageName: overrides.pkg ?? packageName,
        nonce: overrides.nonce ?? nonce,
        timestampMillis: String(overrides.at ?? now.getTime() - 5000),
      },
      appIntegrity: { appRecognitionVerdict: overrides.app ?? "PLAY_RECOGNIZED", packageName },
      deviceIntegrity: { deviceRecognitionVerdict: overrides.device ?? ["MEETS_DEVICE_INTEGRITY"] },
    },
  };
}

function build(...responses: (Response | Error)[]) {
  const fake = queuedFetch(jsonResponse({ access_token: "ya29.token", expires_in: 3600 }), ...responses);
  const tokens = new GoogleAccessTokenProvider(serviceAccount, fake.fetcher, clock, 1000);
  return { ...fake, verifier: new PlayIntegrityVerifier(packageName, tokens, fake.fetcher, clock, 1000) };
}

describe("GoogleAccessTokenProvider + PlayIntegrityVerifier", () => {
  it("exchanges an RS256 assertion at the pinned token endpoint, then decodes the token", async () => {
    const { verifier, calls } = build(jsonResponse(verdict()));
    await expect(verifier.verify("integrity-token", nonce)).resolves.toBe("PASSED");

    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(calls[0].init?.body as URLSearchParams).get("assertion")!;
    const [header, claims, signature] = assertion.split(".");
    const valid = createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"));
    expect(valid).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: "integrity@project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/playintegrity",
      aud: "https://oauth2.googleapis.com/token",
    });

    expect(calls[1].url).toBe(`https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`);
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer ya29.token");
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ integrity_token: "integrity-token" });
  });

  it("reuses the cached access token", async () => {
    const { verifier, calls } = build(jsonResponse(verdict()), jsonResponse(verdict()));
    await verifier.verify("a", nonce);
    await verifier.verify("b", nonce);
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual([
      "oauth2.googleapis.com",
      "playintegrity.googleapis.com",
      "playintegrity.googleapis.com",
    ]);
  });

  it.each([
    ["another nonce", verdict({ nonce: "c29tZW9uZS1lbHNlcy1ub25jZQ" })],
    ["a sideloaded app", verdict({ app: "UNRECOGNIZED_VERSION" })],
    ["an emulator", verdict({ device: [] })],
    ["another package", verdict({ pkg: "com.attacker.clone" })],
    ["a stale request", verdict({ at: now.getTime() - 11 * 60 * 1000 })],
  ])("fails %s", async (_label, body) => {
    const { verifier } = build(jsonResponse(body));
    await expect(verifier.verify("token", nonce)).resolves.toBe("FAILED");
  });

  it("fails a token Google refuses to decode", async () => {
    const { verifier } = build(jsonResponse({ error: { code: 400 } }, 400));
    await expect(verifier.verify("garbage", nonce)).resolves.toBe("FAILED");
  });

  it("reports UNAVAILABLE when Google is down or our credentials fail", async () => {
    await expect(build(new TypeError("fetch failed")).verifier.verify("t", nonce)).resolves.toBe("UNAVAILABLE");
    const broken = queuedFetch(jsonResponse({ error: "invalid_grant" }, 400));
    const tokens = new GoogleAccessTokenProvider(serviceAccount, broken.fetcher, clock, 1000);
    const verifier = new PlayIntegrityVerifier(packageName, tokens, broken.fetcher, clock, 1000);
    await expect(verifier.verify("t", nonce)).resolves.toBe("UNAVAILABLE");
  });
});

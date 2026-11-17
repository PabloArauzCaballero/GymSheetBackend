import { createSign } from "node:crypto";
import { z } from "zod";
import type { AntibotClock, AntibotFetch } from "../antibot.config";
import { fetchAllowlisted } from "../outbound-http";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAY_INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity";
const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().includes("PRIVATE KEY"),
});
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

/**
 * OAuth access token for a Google service account (two-legged JWT bearer
 * flow, RFC 7523) signed with node:crypto, so no Google SDK is needed. The
 * key file's own `token_uri` is ignored on purpose: the endpoint is pinned.
 */
export class GoogleAccessTokenProvider {
  private readonly account: z.infer<typeof serviceAccountSchema>;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    serviceAccountJson: string,
    private readonly fetcher: AntibotFetch,
    private readonly clock: AntibotClock,
    private readonly timeoutMs: number,
  ) {
    this.account = serviceAccountSchema.parse(JSON.parse(serviceAccountJson));
  }

  async getToken(): Promise<string> {
    const now = this.clock().getTime();
    // Renewed a minute early so a token never expires mid-request.
    if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token;
    const response = await fetchAllowlisted(
      this.fetcher,
      TOKEN_URL,
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: this.assertion(Math.floor(now / 1000)),
        }),
      },
      this.timeoutMs,
    );
    if (!response.ok) throw new Error(`Google token exchange failed with HTTP ${response.status}`);
    const parsed = tokenResponseSchema.parse(await response.json());
    this.cached = { token: parsed.access_token, expiresAt: now + parsed.expires_in * 1000 };
    return parsed.access_token;
  }

  private assertion(issuedAtSeconds: number): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: this.account.client_email,
      scope: PLAY_INTEGRITY_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + 3600,
    })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.account.private_key);
    return `${unsigned}.${signature.toString("base64url")}`;
  }
}

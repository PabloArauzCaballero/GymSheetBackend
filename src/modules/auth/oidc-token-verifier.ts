import { HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createPublicKey, KeyObject, verify as verifySignature } from "node:crypto";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";

export type IdentityProvider = "GOOGLE" | "APPLE";

/** Fetches a JWKS document. Injected so tests never touch the network. */
export type JwksFetcher = (url: string) => Promise<unknown>;
export const JWKS_FETCHER = Symbol("JWKS_FETCHER");

const FETCH_TIMEOUT_MS = 5000;

export const fetchJwksOverHttps: JwksFetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`JWKS endpoint answered ${response.status}`);
  return response.json() as Promise<unknown>;
};

export type VerifiedIdentity = {
  provider: IdentityProvider;
  subject: string;
  email: string | null;
  /** Google: its `email_verified` claim. Apple: always true (Apple relays verified addresses). */
  emailVerified: boolean;
};

type ProviderConfig = { jwksUrl: string; issuers: readonly string[]; audiences: () => readonly string[] };

// Fixed URLs (no user input reaches them), so there is no SSRF surface.
const PROVIDERS: Record<IdentityProvider, ProviderConfig> = {
  GOOGLE: {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audiences: () => env.GOOGLE_CLIENT_IDS,
  },
  APPLE: {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audiences: () => env.APPLE_CLIENT_IDS,
  },
};

const KEY_TTL_MS = 60 * 60 * 1000;
/** An unknown `kid` refetches at most this often, so forged kids cannot hammer the provider. */
const MIN_REFETCH_INTERVAL_MS = 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

type CachedKeys = { keys: Map<string, KeyObject>; fetchedAt: number };

function invalidToken(): DomainException {
  return new DomainException(
    HttpStatus.UNAUTHORIZED,
    "IDENTITY_TOKEN_INVALID",
    "No pudimos verificar tu cuenta. Inténtalo de nuevo.",
  );
}

function decodeSegment(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalidToken();
  return parsed as Record<string, unknown>;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Verifies Google / Apple ID tokens (RS256 compact JWS) against the provider
 * JWKS: signature, issuer, audience, expiry and, when the client sent one, the
 * nonce. Keys are cached per provider and `kid` with a TTL.
 */
@Injectable()
export class OidcTokenVerifier {
  private readonly logger = new Logger(OidcTokenVerifier.name);
  private readonly cache = new Map<IdentityProvider, CachedKeys>();

  constructor(@Inject(JWKS_FETCHER) private readonly fetchJwks: JwksFetcher) {}

  async verify(provider: IdentityProvider, token: string, nonce?: string): Promise<VerifiedIdentity> {
    const segments = token.split(".");
    if (segments.length !== 3) throw invalidToken();
    const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];

    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = decodeSegment(headerSegment);
      claims = decodeSegment(payloadSegment);
    } catch {
      throw invalidToken();
    }
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw invalidToken();

    const key = await this.keyFor(provider, header.kid);
    const signed = Buffer.from(`${headerSegment}.${payloadSegment}`);
    if (!key || !verifySignature("sha256", signed, key, Buffer.from(signatureSegment, "base64url"))) {
      throw invalidToken();
    }

    this.assertClaims(provider, claims, nonce);
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
    return {
      provider,
      subject: claims.sub as string,
      email: email || null,
      emailVerified: provider === "APPLE" ? true : isTrue(claims.email_verified),
    };
  }

  private assertClaims(provider: IdentityProvider, claims: Record<string, unknown>, nonce?: string): void {
    const config = PROVIDERS[provider];
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const accepted = config.audiences();
    const valid =
      typeof claims.iss === "string" &&
      config.issuers.includes(claims.iss) &&
      audiences.some((audience) => typeof audience === "string" && accepted.includes(audience)) &&
      typeof claims.exp === "number" &&
      claims.exp + CLOCK_SKEW_SECONDS > now &&
      (claims.iat === undefined || (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS <= now)) &&
      typeof claims.sub === "string" &&
      claims.sub.length > 0 &&
      claims.sub.length <= 255 &&
      (nonce === undefined || this.nonceMatches(provider, claims.nonce, nonce));
    if (!valid) throw invalidToken();
  }

  /** Apple embeds SHA-256(raw nonce) when the client hashed it, as its SDKs recommend. */
  private nonceMatches(provider: IdentityProvider, claimed: unknown, nonce: string): boolean {
    if (typeof claimed !== "string") return false;
    if (claimed === nonce) return true;
    return provider === "APPLE" && claimed === createHash("sha256").update(nonce).digest("hex");
  }

  private async keyFor(provider: IdentityProvider, kid: string): Promise<KeyObject | undefined> {
    const cached = this.cache.get(provider);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < KEY_TTL_MS && cached.keys.has(kid)) return cached.keys.get(kid);
    if (cached && now - cached.fetchedAt < MIN_REFETCH_INTERVAL_MS) return cached.keys.get(kid);

    let document: unknown;
    try {
      document = await this.fetchJwks(PROVIDERS[provider].jwksUrl);
    } catch (error: unknown) {
      this.logger.warn({
        event: "auth.jwks_fetch_failed",
        provider,
        error: error instanceof Error ? error.message : "unknown",
      });
      if (cached?.keys.has(kid)) return cached.keys.get(kid);
      throw new ServiceUnavailableException("No pudimos contactar al proveedor de acceso. Inténtalo de nuevo.");
    }
    const keys = parseJwks(document);
    this.cache.set(provider, { keys, fetchedAt: now });
    return keys.get(kid);
  }
}

function parseJwks(document: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  const entries = (document as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(entries)) return keys;
  for (const entry of entries as unknown[]) {
    const jwk = entry as { kty?: unknown; kid?: unknown; n?: unknown; e?: unknown };
    if (jwk.kty !== "RSA" || typeof jwk.kid !== "string" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
      continue;
    }
    try {
      keys.set(jwk.kid, createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" }));
    } catch {
      // A malformed key is skipped; the others in the set stay usable.
      continue;
    }
  }
  return keys;
}

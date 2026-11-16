import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ANTIBOT_CONFIG, ANTIBOT_FETCH, AntibotConfig, AntibotFetch } from "./antibot.config";
import { fetchAllowlisted, ProviderUnavailableError } from "./outbound-http";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const siteverifySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).default([]),
});

export type TurnstileOutcome = "PASSED" | "FAILED" | "UNAVAILABLE";

/** Layer 3: Cloudflare Turnstile server-side validation (web only, off without a secret). */
@Injectable()
export class TurnstileVerifier {
  constructor(
    @Inject(ANTIBOT_CONFIG) private readonly config: AntibotConfig,
    @Inject(ANTIBOT_FETCH) private readonly fetcher: AntibotFetch,
  ) {}

  get enabled(): boolean {
    return this.config.turnstileSecret !== null;
  }

  /** `idempotencyKey` (a UUID) lets a retried siteverify call reuse the first answer. */
  async verify(token: string | null, ip: string | null, idempotencyKey: string): Promise<TurnstileOutcome> {
    if (!this.config.turnstileSecret || !token || token.length > 2048) return "FAILED";
    const form = new URLSearchParams({
      secret: this.config.turnstileSecret,
      response: token,
      idempotency_key: idempotencyKey,
    });
    if (ip) form.set("remoteip", ip);
    try {
      const response = await fetchAllowlisted(
        this.fetcher,
        SITEVERIFY_URL,
        { method: "POST", body: form },
        this.config.httpTimeoutMs,
      );
      const parsed = siteverifySchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) return "UNAVAILABLE";
      if (parsed.data.success) return "PASSED";
      // Cloudflare's own fault is not the visitor's.
      return parsed.data["error-codes"].includes("internal-error") ? "UNAVAILABLE" : "FAILED";
    } catch (error: unknown) {
      if (error instanceof ProviderUnavailableError) return "UNAVAILABLE";
      throw error;
    }
  }
}

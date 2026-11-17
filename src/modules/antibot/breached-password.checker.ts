import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ANTIBOT_CONFIG, ANTIBOT_FETCH, AntibotConfig, AntibotFetch } from "./antibot.config";
import { fetchAllowlisted, ProviderUnavailableError } from "./outbound-http";

export type BreachOutcome = "BREACHED" | "CLEAN" | "UNAVAILABLE" | "DISABLED";

/**
 * Layer 7: Have I Been Pwned range API with k-anonymity. Only the first five
 * hex characters of the SHA-1 leave the server; the match happens locally.
 * `Add-Padding` makes every response the same size so the prefix's popularity
 * does not leak through response length either.
 */
@Injectable()
export class BreachedPasswordChecker {
  constructor(
    @Inject(ANTIBOT_CONFIG) private readonly config: AntibotConfig,
    @Inject(ANTIBOT_FETCH) private readonly fetcher: AntibotFetch,
  ) {}

  async check(password: string): Promise<BreachOutcome> {
    if (!this.config.breachCheckEnabled) return "DISABLED";
    const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await fetchAllowlisted(
        this.fetcher,
        `https://api.pwnedpasswords.com/range/${prefix}`,
        { method: "GET", headers: { "Add-Padding": "true", "User-Agent": "gym-sheet-api" } },
        this.config.httpTimeoutMs,
      );
      if (!response.ok) return "UNAVAILABLE";
      const body = await response.text();
      for (const line of body.split("\n")) {
        const [candidate, count] = line.trim().split(":");
        // Padding rows carry a count of 0 and never mean "breached".
        if (candidate === suffix && Number(count) > 0) return "BREACHED";
      }
      return "CLEAN";
    } catch (error: unknown) {
      if (error instanceof ProviderUnavailableError) return "UNAVAILABLE";
      throw error;
    }
  }
}

import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { AntibotClock, AntibotFetch } from "../antibot.config";
import { fetchAllowlisted, ProviderUnavailableError } from "../outbound-http";
import type { GoogleAccessTokenProvider } from "./google-access-token";
import { ATTESTATION_NONCE_TTL_MS } from "./attestation-challenge.service";

export type AttestationOutcome = "PASSED" | "FAILED" | "UNAVAILABLE" | "UNSUPPORTED";

const verdictSchema = z.object({
  tokenPayloadExternal: z.object({
    requestDetails: z.object({
      requestPackageName: z.string(),
      nonce: z.string(),
      timestampMillis: z.coerce.number(),
    }),
    appIntegrity: z.object({
      appRecognitionVerdict: z.string(),
      packageName: z.string().optional(),
    }),
    deviceIntegrity: z.object({
      deviceRecognitionVerdict: z.array(z.string()).default([]),
    }),
  }),
});

/**
 * Android Play Integrity: Google decrypts and verifies the integrity token
 * server-side (`decodeIntegrityToken`), and this checks what Google vouched
 * for: our nonce, our package, an app installed from Play, a genuine device.
 */
export class PlayIntegrityVerifier {
  constructor(
    private readonly packageName: string,
    private readonly tokens: GoogleAccessTokenProvider,
    private readonly fetcher: AntibotFetch,
    private readonly clock: AntibotClock,
    private readonly timeoutMs: number,
  ) {}

  private readonly logger = new Logger(PlayIntegrityVerifier.name);

  async verify(integrityToken: string, expectedNonce: string): Promise<AttestationOutcome> {
    let accessToken: string;
    try {
      accessToken = await this.tokens.getToken();
    } catch (error: unknown) {
      // Our credentials failing is not the device's fault: raise risk, do not reject.
      this.logger.error({
        event: "antibot.google_token_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
      return "UNAVAILABLE";
    }
    try {
      const response = await fetchAllowlisted(
        this.fetcher,
        `https://playintegrity.googleapis.com/v1/${encodeURIComponent(this.packageName)}:decodeIntegrityToken`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ integrity_token: integrityToken }),
        },
        this.timeoutMs,
      );
      // 4xx = Google rejected the token itself (malformed, wrong app, replayed).
      if (!response.ok) return "FAILED";
      const parsed = verdictSchema.safeParse(await response.json().catch(() => null));
      return parsed.success ? this.judge(parsed.data.tokenPayloadExternal, expectedNonce) : "FAILED";
    } catch (error: unknown) {
      if (error instanceof ProviderUnavailableError) return "UNAVAILABLE";
      throw error;
    }
  }

  private judge(payload: z.infer<typeof verdictSchema>["tokenPayloadExternal"], expectedNonce: string): AttestationOutcome {
    const age = this.clock().getTime() - payload.requestDetails.timestampMillis;
    const genuine =
      payload.requestDetails.requestPackageName === this.packageName &&
      payload.requestDetails.nonce === expectedNonce &&
      age >= -60_000 &&
      age <= ATTESTATION_NONCE_TTL_MS &&
      payload.appIntegrity.appRecognitionVerdict === "PLAY_RECOGNIZED" &&
      (payload.appIntegrity.packageName === undefined || payload.appIntegrity.packageName === this.packageName) &&
      payload.deviceIntegrity.deviceRecognitionVerdict.includes("MEETS_DEVICE_INTEGRITY");
    return genuine ? "PASSED" : "FAILED";
  }
}

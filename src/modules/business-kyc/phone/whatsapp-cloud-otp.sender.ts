import { Logger } from "@nestjs/common";
import { PhoneOtpDelivery, PhoneOtpFetch, PhoneOtpSender } from "./phone-otp.port";

export type WhatsAppCloudConfig = {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  apiVersion: string;
  timeoutMs: number;
};

/** Fixed host: the URL is never built from input (SSRF). */
const GRAPH_HOST = "https://graph.facebook.com";

/**
 * Sends the code with the Meta WhatsApp Business Cloud API: a template message
 * of the AUTHENTICATION category (`POST /{version}/{phone-number-id}/messages`),
 * the code as the body parameter and as the copy-code button parameter, as
 * Meta requires for authentication templates. Never throws and never logs the
 * code or the phone: the outcome is the return value.
 */
export class WhatsAppCloudOtpSender implements PhoneOtpSender {
  readonly name = "whatsapp-cloud";
  readonly available = true;
  private readonly logger = new Logger(WhatsAppCloudOtpSender.name);

  constructor(
    private readonly config: WhatsAppCloudConfig,
    private readonly fetcher: PhoneOtpFetch,
  ) {}

  async send(phoneE164: string, code: string): Promise<PhoneOtpDelivery> {
    const url = `${GRAPH_HOST}/${this.config.apiVersion}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phoneE164.replace(/^\+/u, ""),
          type: "template",
          template: {
            name: this.config.templateName,
            language: { code: this.config.languageCode },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
            ],
          },
        }),
      });
      if (response.ok) return { delivered: true };
      // 4xx: Meta refused this request (bad number, template, token); 5xx: try again later.
      this.logger.warn({ event: "phone_otp.whatsapp_rejected", status: response.status });
      return { delivered: false, reason: response.status < 500 ? "REJECTED" : "FAILED" };
    } catch (error: unknown) {
      this.logger.warn({ event: "phone_otp.whatsapp_failed", errorName: error instanceof Error ? error.name : "UnknownError" });
      return { delivered: false, reason: "FAILED" };
    } finally {
      clearTimeout(timer);
    }
  }
}

import { PhoneOtpFetch } from "./phone-otp.port";
import { WhatsAppCloudOtpSender } from "./whatsapp-cloud-otp.sender";

const config = {
  accessToken: "test-access-token-0123456789",
  phoneNumberId: "1234567890",
  templateName: "repp_codigo",
  languageCode: "es",
  apiVersion: "v21.0",
  timeoutMs: 1000,
};

function fakeTransport(status: number): { fetcher: PhoneOtpFetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: PhoneOtpFetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
    return Promise.resolve(new Response("{}", { status }));
  };
  return { fetcher, calls };
}

describe("WhatsAppCloudOtpSender", () => {
  it("posts an authentication template to the fixed Graph host with the code in body and button", async () => {
    const transport = fakeTransport(200);
    const outcome = await new WhatsAppCloudOtpSender(config, transport.fetcher).send("+59171234567", "482913");

    expect(outcome).toEqual({ delivered: true });
    expect(transport.calls).toHaveLength(1);
    const [call] = transport.calls;
    expect(call.url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${config.accessToken}`);
    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "59171234567",
      type: "template",
      template: {
        name: "repp_codigo",
        language: { code: "es" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "482913" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
        ],
      },
    });
  });

  it("reports a 4xx as REJECTED and a 5xx as FAILED, without throwing", async () => {
    await expect(new WhatsAppCloudOtpSender(config, fakeTransport(400).fetcher).send("+59171234567", "1")).resolves.toEqual({
      delivered: false,
      reason: "REJECTED",
    });
    await expect(new WhatsAppCloudOtpSender(config, fakeTransport(503).fetcher).send("+59171234567", "1")).resolves.toEqual({
      delivered: false,
      reason: "FAILED",
    });
  });

  it("reports a transport error as FAILED", async () => {
    const failing: PhoneOtpFetch = () => Promise.reject(new TypeError("network down"));
    await expect(new WhatsAppCloudOtpSender(config, failing).send("+59171234567", "1")).resolves.toEqual({
      delivered: false,
      reason: "FAILED",
    });
  });
});

import { sendMessageSchema } from "./chat.schemas";
import { isChatStickerId } from "./chat-sticker-catalog";

describe("H7.S1.M3 catalog contract", () => {
  it.each(["gym.cheer.v1", "gym.strong.v1"])("accepts exact catalog ID %s", stickerId => {
    expect(isChatStickerId(stickerId)).toBe(true);
    expect(sendMessageSchema.parse({ type: "sticker", stickerId })).toEqual({ type: "sticker", stickerId });
  });
  it.each(["unknown", "https://example.test/sticker.png", "gym.cheer.v1 ", "GYM.CHEER.V1", "__proto__"])("rejects noncatalog ID %s", stickerId => {
    expect(isChatStickerId(stickerId)).toBe(false);
    expect(sendMessageSchema.safeParse({ type: "sticker", stickerId }).success).toBe(false);
  });
  it.each(["url", "mediaUrl", "body", "locationLat"])("rejects extra sticker field %s", field => {
    expect(sendMessageSchema.safeParse({ type: "sticker", stickerId: "gym.cheer.v1", [field]: "http://127.0.0.1/private" }).success).toBe(false);
  });
});

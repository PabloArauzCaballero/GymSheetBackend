import { chatRequestFingerprint } from "./chat-request-fingerprint";

describe("chat request fingerprint v1", () => {
  it("normalizes missing values and negative zero, preserves exact original payload distinctions", () => {
    const base = chatRequestFingerprint({ type: "location", locationLat: 0, locationLng: -0 });
    expect(base).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(base).toBe(chatRequestFingerprint({ type: "location", body: null, locationLat: -0, locationLng: 0 }));
    for (const changed of [
      { type: "location" as const, body: "", locationLat: 0, locationLng: 0 },
      { type: "location" as const, locationLat: null, locationLng: 0 },
      { type: "location" as const, locationLat: 0, locationLng: 1 },
      { type: "text" as const, body: "0" },
    ]) expect(chatRequestFingerprint(changed)).not.toBe(base);
    expect(chatRequestFingerprint({ type: "text", body: "original" })).not.toBe(chatRequestFingerprint({ type: "text", body: "edited" }));
  });

  it("includes a story reference in the versioned fingerprint without changing legacy request hashes", () => {
    const legacy = { type: "text" as const, body: "hola" };
    const storyId = "00000000-0000-4000-8000-00000000000f";
    expect(chatRequestFingerprint(legacy)).toMatch(/^v1:/);
    expect(chatRequestFingerprint({ ...legacy, storyId })).toMatch(/^v2:/);
    expect(chatRequestFingerprint({ ...legacy, storyId })).not.toBe(chatRequestFingerprint(legacy));
    expect(chatRequestFingerprint({ ...legacy, storyId })).not.toBe(
      chatRequestFingerprint({ ...legacy, storyId: "00000000-0000-4000-8000-000000000010" }),
    );
  });
});

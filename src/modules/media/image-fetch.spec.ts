import { assertAllowedImageUrl } from "./image-fetch";

describe("assertAllowedImageUrl", () => {
  const allowed = ["images.unsplash.com", "raw.githubusercontent.com"];

  it("accepts an https URL on an allowlisted host", () => {
    const url = assertAllowedImageUrl(
      "https://images.unsplash.com/photo-123?auto=format",
      allowed,
    );
    expect(url.hostname).toBe("images.unsplash.com");
  });

  it("is case-insensitive on the host", () => {
    expect(() =>
      assertAllowedImageUrl("https://IMAGES.UNSPLASH.COM/x.jpg", allowed),
    ).not.toThrow();
  });

  it("rejects a non-allowlisted host (SSRF guard)", () => {
    expect(() =>
      assertAllowedImageUrl("https://evil.example.com/x.jpg", allowed),
    ).toThrow(/no permitido/i);
  });

  it("rejects non-https, credentials and explicit ports", () => {
    expect(() =>
      assertAllowedImageUrl("http://images.unsplash.com/x.jpg", allowed),
    ).toThrow(/https/i);
    expect(() =>
      assertAllowedImageUrl("https://user:pass@images.unsplash.com/x.jpg", allowed),
    ).toThrow();
    expect(() =>
      assertAllowedImageUrl("https://images.unsplash.com:8443/x.jpg", allowed),
    ).toThrow();
  });

  it("rejects a malformed URL", () => {
    expect(() => assertAllowedImageUrl("not a url", allowed)).toThrow(
      /inválida/i,
    );
  });
});

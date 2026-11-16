import { looksAutomated, scoreRisk } from "./risk-score";

describe("risk score", () => {
  it("is LOW without signals, MEDIUM with one and HIGH with two or more distinct ones", () => {
    expect(scoreRisk([])).toBe("LOW");
    expect(scoreRisk(["BREACHED_PASSWORD"])).toBe("MEDIUM");
    expect(scoreRisk(["BREACHED_PASSWORD", "BREACHED_PASSWORD"])).toBe("MEDIUM");
    expect(scoreRisk(["BREACHED_PASSWORD", "IP_VELOCITY"])).toBe("HIGH");
  });

  it("flags headless browsers, HTTP libraries and missing user agents", () => {
    for (const userAgent of [
      null,
      "",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36",
      "python-requests/2.31.0",
      "curl/8.4.0",
      "Go-http-client/2.0",
    ]) {
      expect(looksAutomated(userAgent)).toBe(true);
    }
  });

  it("does not flag real browsers or the React Native app stacks", () => {
    for (const userAgent of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.1 Safari/605.1.15",
      "okhttp/4.12.0",
      "GymSheet/12 CFNetwork/1490.0.4 Darwin/23.2.0",
    ]) {
      expect(looksAutomated(userAgent)).toBe(false);
    }
  });
});

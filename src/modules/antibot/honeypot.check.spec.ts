import { honeypotTripped } from "./honeypot.check";

describe("honeypotTripped", () => {
  it("passes an absent or blank field", () => {
    expect(honeypotTripped(null)).toBe(false);
    expect(honeypotTripped("")).toBe(false);
    expect(honeypotTripped("  \n")).toBe(false);
  });

  it("trips on any content", () => {
    expect(honeypotTripped("https://spam.example")).toBe(true);
  });
});

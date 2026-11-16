import { addBusinessHours } from "./kyc-sla";

const ZONE = "America/La_Paz";

describe("addBusinessHours", () => {
  it("counts weekday hours as they are", () => {
    // Tuesday 10:00 La Paz (UTC-4).
    expect(addBusinessHours(new Date("2026-11-17T14:00:00Z"), 24, ZONE).toISOString()).toBe("2026-11-18T14:00:00.000Z");
  });

  it("skips the weekend: Friday evening plus 24 business hours is Monday evening", () => {
    // Friday 18:00 La Paz → the 6 hours left of Friday, then Monday 00:00–18:00.
    expect(addBusinessHours(new Date("2026-11-20T22:00:00Z"), 24, ZONE).toISOString()).toBe("2026-11-23T22:00:00.000Z");
  });

  it("starts counting on Monday for a Saturday submission", () => {
    expect(addBusinessHours(new Date("2026-11-21T14:00:00Z"), 1, ZONE).toISOString()).toBe("2026-11-23T05:00:00.000Z");
  });
});

import {
  CouponRecord,
  PRIZE_CODE_ALPHABET,
  PRIZE_CODE_PATTERN,
  effectivePrizeStatus,
  generatePrizeCode,
  hasStock,
  prizeExpiry,
  toPrizeView,
} from "./prizes";
import { redeemPrizeSchema } from "./progression.schemas";
import { chainPositions, nextStreakMilestone, pickNearest, type BadgeView } from "./progression.service";

describe("prize codes", () => {
  it("uses six characters without 0, O, 1 or I", () => {
    expect(PRIZE_CODE_ALPHABET).not.toMatch(/[01IO]/u);
    expect(PRIZE_CODE_ALPHABET).toHaveLength(32);
    for (let index = 0; index < 500; index += 1) {
      expect(generatePrizeCode()).toMatch(PRIZE_CODE_PATTERN);
    }
  });

  it("draws every position from the alphabet", () => {
    let call = 0;
    expect(generatePrizeCode(() => call++ % 32)).toBe("ABCDEF");
  });

  it("accepts a code typed in lowercase at the front desk, and rejects confusable characters", () => {
    expect(redeemPrizeSchema.parse({ code: " k7m2qx " }).code).toBe("K7M2QX");
    expect(redeemPrizeSchema.safeParse({ code: "K7M2Q0" }).success).toBe(false);
    expect(redeemPrizeSchema.safeParse({ code: "K7M2QI" }).success).toBe(false);
    expect(redeemPrizeSchema.safeParse({ code: "K7M2Q" }).success).toBe(false);
  });
});

describe("prize stock and expiry", () => {
  it("respects the stock and treats no stock as unlimited", () => {
    expect(hasStock(null, 10_000)).toBe(true);
    expect(hasStock(2, 1)).toBe(true);
    expect(hasStock(2, 2)).toBe(false);
    expect(hasStock(0, 0)).toBe(false);
  });

  it("expires a coupon validDays after it was awarded, or never", () => {
    const awarded = new Date("2026-10-18T12:00:00Z");
    expect(prizeExpiry(awarded, null)).toBeNull();
    expect(prizeExpiry(awarded, 7)?.toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });

  it("reads an expired available coupon as CADUCADO, and never touches a redeemed one", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(effectivePrizeStatus("DISPONIBLE", null, now)).toBe("DISPONIBLE");
    expect(effectivePrizeStatus("DISPONIBLE", new Date("2026-10-21T00:00:00Z"), now)).toBe("DISPONIBLE");
    expect(effectivePrizeStatus("DISPONIBLE", new Date("2026-10-19T00:00:00Z"), now)).toBe("CADUCADO");
    expect(effectivePrizeStatus("CANJEADO", new Date("2026-10-19T00:00:00Z"), now)).toBe("CANJEADO");
  });

  it("maps a coupon to the ticket the member sees", () => {
    const coupon: CouponRecord = {
      id: "c-1",
      prizeId: "p-1",
      userId: "u-1",
      sourceRef: "RACHA_30",
      code: "K7M2QX",
      status: "DISPONIBLE",
      awardedAt: new Date("2026-10-18T12:00:00Z"),
      expiresAt: null,
      redeemedAt: null,
      seen: false,
      title: "Batido de proteína gratis",
      description: null,
      instructions: "Enséñalo en recepción",
      icon: "gift-outline",
      targetKind: "BADGE",
      targetCode: "RACHA_30",
    };
    expect(toPrizeView(coupon, "Treinta días de fuego")).toEqual({
      id: "c-1",
      title: "Batido de proteína gratis",
      description: null,
      instructions: "Enséñalo en recepción",
      icon: "gift-outline",
      source: { kind: "BADGE", code: "RACHA_30", name: "Treinta días de fuego" },
      code: "K7M2QX",
      status: "DISPONIBLE",
      awardedAt: "2026-10-18T12:00:00.000Z",
      expiresAt: null,
      redeemedAt: null,
      isNew: true,
    });
  });
});

describe("collection chains and «lo más cerca»", () => {
  it("groups badges of the same criterion into a chain ordered by threshold", () => {
    const chains = chainPositions([
      { code: "RACHA_30", criterionType: "STREAK_DAYS", criterionThreshold: "30.00", secret: false },
      { code: "RACHA_3", criterionType: "STREAK_DAYS", criterionThreshold: "3.00", secret: false },
      { code: "RACHA_7", criterionType: "STREAK_DAYS", criterionThreshold: "7.00", secret: false },
      { code: "PRIMERA_SESION", criterionType: "SESSION_COUNT", criterionThreshold: "1.00", secret: false },
    ]);
    expect(chains.get("RACHA_7")).toEqual({ chain: "STREAK_DAYS", chainStep: 2, chainLength: 3 });
    expect(chains.get("PRIMERA_SESION")).toEqual({ chain: "SESSION_COUNT", chainStep: 1, chainLength: 1 });
  });

  it("keeps secret badges out of the public chain of the same criterion", () => {
    const chains = chainPositions([
      { code: "A", criterionType: "EARLY_SESSIONS", criterionThreshold: "1.00", secret: false },
      { code: "B", criterionType: "EARLY_SESSIONS", criterionThreshold: "5.00", secret: true },
    ]);
    expect(chains.get("A")?.chainLength).toBe(1);
  });

  it("picks up to three unearned, non-secret badges with the most progress", () => {
    const badge = (code: string, progress: number, extra: Partial<BadgeView> = {}) =>
      ({ code, progress, earned: false, secret: false, ...extra }) as BadgeView;
    const nearest = pickNearest([
      badge("A", 0.2),
      badge("B", 0.9),
      badge("C", 0.95, { earned: true }),
      badge("D", 0.99, { secret: true }),
      badge("E", 0.5),
      badge("F", 0.5),
    ]);
    expect(nearest.map((entry) => entry.code)).toEqual(["B", "E", "F"]);
  });

  it("points at the next streak milestone", () => {
    expect(nextStreakMilestone(0)).toBe(3);
    expect(nextStreakMilestone(12)).toBe(14);
    expect(nextStreakMilestone(365)).toBeNull();
  });
});

import { HttpException } from "@nestjs/common";
import { KYC_STATUSES, KycStatus } from "./kyc.catalog";
import { assertKycTransition, canTransition } from "./kyc-state-machine";

const ALLOWED: readonly [KycStatus, KycStatus][] = [
  ["DRAFT", "SUBMITTED"],
  ["SUBMITTED", "AUTO_APPROVED"],
  ["SUBMITTED", "IN_REVIEW"],
  ["AUTO_APPROVED", "APPROVED"],
  ["AUTO_APPROVED", "SUSPENDED"],
  ["AUTO_APPROVED", "REJECTED"],
  ["IN_REVIEW", "APPROVED"],
  ["IN_REVIEW", "REJECTED"],
  ["APPROVED", "SUSPENDED"],
  ["SUSPENDED", "APPROVED"],
  ["SUSPENDED", "REJECTED"],
];
const allowed = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));
const pairs = KYC_STATUSES.flatMap((from) => KYC_STATUSES.map((to) => [from, to] as const));

describe("KYC state machine (plan §2.5)", () => {
  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertKycTransition(from, to)).not.toThrow();
  });

  it.each(pairs.filter(([from, to]) => !allowed.has(`${from}->${to}`)))("refuses %s -> %s with 409 KYC_INVALID_TRANSITION", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    try {
      assertKycTransition(from, to);
      throw new Error("expected a refusal");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpException);
      const http = error as HttpException;
      expect(http.getStatus()).toBe(409);
      expect(http.getResponse()).toMatchObject({ code: "KYC_INVALID_TRANSITION", details: { from, to } });
    }
  });

  it("keeps REJECTED terminal for the attempt and never re-enters DRAFT", () => {
    expect(KYC_STATUSES.filter((to) => canTransition("REJECTED", to))).toEqual([]);
    expect(KYC_STATUSES.filter((from) => canTransition(from, "DRAFT"))).toEqual([]);
  });
});

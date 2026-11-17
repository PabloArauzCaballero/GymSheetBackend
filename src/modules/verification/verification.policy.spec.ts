import { HttpException, HttpStatus } from "@nestjs/common";
import { describeGesture, pickGesture, VERIFICATION_GESTURES, VerificationStatus } from "./verification.catalog";
import {
  assertTransition,
  canTransition,
  isChallengeExpired,
  nextAttemptAt,
  rateLimited,
  retentionCutoffs,
  VERIFICATION_REVIEW_DEADLINE_DAYS,
} from "./verification.policy";
import { decideVerificationSchema, verificationQueueQuerySchema } from "./verification.schemas";

const now = new Date("2026-11-20T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

describe("gesture catalog", () => {
  it("has eight gestures, each with a Spanish instruction", () => {
    expect(Object.keys(VERIFICATION_GESTURES)).toHaveLength(8);
    expect(describeGesture("THUMB_UP")).toEqual({ code: "THUMB_UP", instruction: "Haz un pulgar arriba junto a tu cara" });
  });

  it("never repeats the previous attempt's gesture, whatever the random draw", () => {
    for (let draw = 0; draw < 7; draw += 1) {
      expect(pickGesture("THUMB_UP", () => draw).code).not.toBe("THUMB_UP");
    }
    const draws: number[] = [];
    pickGesture("PEACE_SIGN", (max) => {
      draws.push(max);
      return 0;
    });
    expect(draws).toEqual([7]);
  });

  it("draws among all eight on a first attempt with the CSPRNG", () => {
    const seen = new Set(Array.from({ length: 200 }, () => pickGesture(null).code));
    expect(seen.size).toBeGreaterThan(4);
    for (const code of seen) expect(Object.keys(VERIFICATION_GESTURES)).toContain(code);
  });
});

describe("rolling 24 h attempt limit", () => {
  it("allows a challenge while fewer than three attempts are in the window", () => {
    expect(nextAttemptAt([hoursAgo(1), hoursAgo(2)], now)).toBeNull();
    expect(nextAttemptAt([hoursAgo(1), hoursAgo(2), hoursAgo(25)], now)).toBeNull();
  });

  it("frees the slot when the oldest counted attempt leaves the window", () => {
    const retryAt = nextAttemptAt([hoursAgo(20), hoursAgo(1), hoursAgo(5)], now);
    expect(retryAt).toEqual(new Date(hoursAgo(20).getTime() + 24 * 60 * 60 * 1000));
  });

  it("answers 429 VERIFICATION_RATE_LIMITED with retryAfterSeconds", () => {
    const error = rateLimited(new Date(now.getTime() + 90_500), now);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.getResponse()).toMatchObject({ code: "VERIFICATION_RATE_LIMITED", details: { retryAfterSeconds: 91 } });
  });
});

describe("state machine", () => {
  it.each([
    ["PENDING_UPLOAD", "PENDING_REVIEW", true],
    ["PENDING_UPLOAD", "EXPIRED", true],
    ["PENDING_REVIEW", "APPROVED", true],
    ["PENDING_REVIEW", "REJECTED", true],
    ["PENDING_REVIEW", "EXPIRED", true],
    ["PENDING_UPLOAD", "APPROVED", false],
    ["APPROVED", "REJECTED", false],
    ["REJECTED", "PENDING_REVIEW", false],
    ["EXPIRED", "PENDING_REVIEW", false],
  ] as const)("%s -> %s allowed: %s", (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  it("maps a forbidden move to 409, and an expired challenge to VERIFICATION_CHALLENGE_EXPIRED", () => {
    const codeOf = (run: () => void) => {
      try {
        run();
      } catch (error) {
        return [(error as HttpException).getStatus(), (error as HttpException).getResponse()] as const;
      }
      return null;
    };
    expect(codeOf(() => assertTransition(VerificationStatus.APPROVED, VerificationStatus.REJECTED)))
      .toEqual([409, expect.objectContaining({ code: "VERIFICATION_STATE_CONFLICT" })]);
    expect(codeOf(() => assertTransition(VerificationStatus.EXPIRED, VerificationStatus.PENDING_REVIEW)))
      .toEqual([409, expect.objectContaining({ code: "VERIFICATION_CHALLENGE_EXPIRED" })]);
    expect(codeOf(() => assertTransition(VerificationStatus.PENDING_UPLOAD, VerificationStatus.PENDING_REVIEW))).toBeNull();
  });

  it("treats the expiry instant itself as expired", () => {
    expect(isChallengeExpired(now, now)).toBe(true);
    expect(isChallengeExpired(new Date(now.getTime() + 1), now)).toBe(false);
  });
});

describe("retention cut-offs", () => {
  it("keeps decided selfies 30 days, closes challenges after 24 h and undecided reviews after 30 days", () => {
    expect(VERIFICATION_REVIEW_DEADLINE_DAYS).toBe(30);
    expect(retentionCutoffs(now)).toEqual({
      decidedBefore: new Date("2026-10-21T12:00:00.000Z"),
      issuedBefore: new Date("2026-11-19T12:00:00.000Z"),
      submittedBefore: new Date("2026-10-21T12:00:00.000Z"),
    });
  });
});

describe("request schemas", () => {
  it("requires a closed-list reason on REJECT and forbids one on APPROVE", () => {
    expect(decideVerificationSchema.safeParse({ decision: "REJECT" }).success).toBe(false);
    expect(decideVerificationSchema.safeParse({ decision: "REJECT", reason: "BLURRY" }).success).toBe(false);
    expect(decideVerificationSchema.safeParse({ decision: "APPROVE", reason: "OTHER" }).success).toBe(false);
    expect(decideVerificationSchema.safeParse({ decision: "REJECT", reason: "GESTURE_MISMATCH" }).success).toBe(true);
    expect(decideVerificationSchema.safeParse({ decision: "APPROVE", extra: 1 }).success).toBe(false);
  });

  it("defaults the queue to PENDING_REVIEW and bounds the limit", () => {
    expect(verificationQueueQuerySchema.parse({})).toEqual({ status: "PENDING_REVIEW", limit: 20 });
    expect(verificationQueueQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });
});

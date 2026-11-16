import { ForbiddenException, HttpException, NotFoundException } from "@nestjs/common";
import { Transaction, UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ChatMediaCipher } from "../chat/chat-media-cipher";
import { MediaStorageProvider } from "../media/media-storage.port";
import { PhotoVerificationModel } from "./photo-verification.model";
import { VerificationRepository } from "./verification.repository";
import { VerificationService } from "./verification.service";

const userId = "00000000-0000-4000-8000-000000000001";
const verificationId = "00000000-0000-4000-8000-0000000000aa";
const now = new Date("2026-11-20T12:00:00.000Z");
const tx = { id: "tx" } as unknown as Transaction;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const selfie = { originalname: "s.jpg", mimetype: "image/jpeg", size: JPEG.length, buffer: JPEG };

function row(overrides: Partial<PhotoVerificationModel> = {}): PhotoVerificationModel {
  return {
    id: verificationId,
    userId,
    gestureCode: "THUMB_UP",
    status: "PENDING_UPLOAD",
    challengeIssuedAt: new Date(now.getTime() - 60_000),
    challengeExpiresAt: new Date(now.getTime() + 9 * 60_000),
    submittedAt: null,
    decidedAt: null,
    decisionReason: null,
    createdAt: new Date(now.getTime() - 60_000),
    ...overrides,
  } as PhotoVerificationModel;
}

function setup(overrides: Partial<Record<keyof VerificationRepository, jest.Mock>> = {}) {
  const repository = {
    lockUser: jest.fn().mockResolvedValue({ verifiedAt: null }),
    findActiveForUser: jest.fn().mockResolvedValue(null),
    visiblePhotos: jest.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }]),
    attemptDatesSince: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    findLatestForUser: jest.fn().mockResolvedValue(null),
    create: jest.fn(async (input: { gestureCode: string; expiresAt: Date }) =>
      row({ gestureCode: input.gestureCode as never, challengeExpiresAt: input.expiresAt })),
    findByIdForUser: jest.fn().mockResolvedValue(row()),
    userVerifiedAt: jest.fn().mockResolvedValue(null),
    findLatestDecided: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
  const storage = {
    immutable: false,
    upload: jest.fn().mockResolvedValue({ key: "users/u/verificaciones/k.jpg" }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const consent = { assertGranted: jest.fn().mockResolvedValue(undefined) };
  const cipher = new ChatMediaCipher("s".repeat(64));
  const sequelize = { transaction: jest.fn(async (run: (t: Transaction) => unknown) => run(tx)) };
  const service = new VerificationService(
    sequelize as unknown as Sequelize,
    repository as unknown as VerificationRepository,
    storage as unknown as MediaStorageProvider,
    cipher,
    consent,
    () => now,
  );
  return { service, repository, storage, consent, cipher };
}

const errorBody = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { status: (error as HttpException).getStatus(), body: (error as HttpException).getResponse() };
  }
  throw new Error("expected rejection");
};

describe("VerificationService.issueChallenge", () => {
  it("issues a 10-minute challenge with a gesture different from the previous attempt", async () => {
    const { service, repository, consent } = setup({
      findLatestForUser: jest.fn().mockResolvedValue(row({ gestureCode: "PEACE_SIGN", status: "REJECTED" })),
    });
    const challenge = await service.issueChallenge(userId);
    expect(consent.assertGranted).toHaveBeenCalledWith(userId);
    expect(challenge.gesture.code).not.toBe("PEACE_SIGN");
    expect(challenge.gesture.instruction).toEqual(expect.any(String));
    expect(challenge.expiresAt).toBe("2026-11-20T12:10:00.000Z");
    expect(repository.lockUser).toHaveBeenCalledWith(userId, tx);
  });

  it("stays closed on storage that cannot delete: the selfie must be erasable after 30 days", async () => {
    const { service, storage, repository } = setup();
    storage.immutable = true;
    await expect(service.issueChallenge(userId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VERIFICATION_UNAVAILABLE" }),
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("stops before anything else when consent is missing", async () => {
    const { service, consent, repository } = setup();
    consent.assertGranted.mockRejectedValue(new ForbiddenException("sin consentimiento"));
    await expect(service.issueChallenge(userId)).rejects.toThrow(ForbiddenException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("requires two visible profile photos (400 VERIFICATION_PHOTOS_REQUIRED)", async () => {
    const { service } = setup({ visiblePhotos: jest.fn().mockResolvedValue([{ id: "p1" }]) });
    expect(await errorBody(service.issueChallenge(userId)))
      .toMatchObject({ status: 400, body: { code: "VERIFICATION_PHOTOS_REQUIRED" } });
  });

  it("refuses a fourth attempt in 24 h with 429 and retryAfterSeconds", async () => {
    const attempts = [1, 2, 3].map((hours) => new Date(now.getTime() - hours * 3_600_000));
    const { service, repository } = setup({ attemptDatesSince: jest.fn().mockResolvedValue(attempts) });
    expect(await errorBody(service.issueChallenge(userId))).toMatchObject({
      status: 429,
      body: { code: "VERIFICATION_RATE_LIMITED", details: { retryAfterSeconds: 21 * 3600 } },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("returns 409 when already verified or while a selfie is in review", async () => {
    const verified = setup({ lockUser: jest.fn().mockResolvedValue({ verifiedAt: now }) });
    expect(await errorBody(verified.service.issueChallenge(userId)))
      .toMatchObject({ status: 409, body: { code: "VERIFICATION_ALREADY_VERIFIED" } });
    const inReview = setup({ findActiveForUser: jest.fn().mockResolvedValue(row({ status: "PENDING_REVIEW" })) });
    expect(await errorBody(inReview.service.issueChallenge(userId)))
      .toMatchObject({ status: 409, body: { code: "VERIFICATION_IN_REVIEW" } });
  });

  it("expires an unanswered challenge when issuing a new one", async () => {
    const { service, repository } = setup({ findActiveForUser: jest.fn().mockResolvedValue(row()) });
    await service.issueChallenge(userId);
    expect(repository.update).toHaveBeenCalledWith(verificationId, { status: "EXPIRED" }, tx);
  });

  it("maps a concurrent active-attempt race to 409", async () => {
    const { service } = setup({ create: jest.fn().mockRejectedValue(new UniqueConstraintError({})) });
    expect(await errorBody(service.issueChallenge(userId)))
      .toMatchObject({ status: 409, body: { code: "VERIFICATION_STATE_CONFLICT" } });
  });
});

describe("VerificationService.submitSelfie", () => {
  it("encrypts the selfie into private storage and moves to PENDING_REVIEW", async () => {
    const { service, repository, storage, cipher } = setup();
    const result = await service.submitSelfie(userId, verificationId, selfie);
    expect(result).toEqual({ id: verificationId, status: "PENDING_REVIEW", submittedAt: now.toISOString() });
    const [input, target] = storage.upload.mock.calls[0];
    expect(target).toEqual({ category: "verificaciones", ownerUserId: userId });
    expect(input.buffer.equals(JPEG)).toBe(false);
    expect(cipher.decrypt(input.buffer).equals(JPEG)).toBe(true);
    expect(repository.update).toHaveBeenCalledWith(
      verificationId,
      expect.objectContaining({ status: "PENDING_REVIEW", selfieStorageKey: "users/u/verificaciones/k.jpg", selfieMimeType: "image/jpeg" }),
      tx,
    );
  });

  it("answers 404 for another member's verification", async () => {
    const { service, storage } = setup({ findByIdForUser: jest.fn().mockResolvedValue(null) });
    await expect(service.submitSelfie(userId, verificationId, selfie)).rejects.toThrow(NotFoundException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("closes an expired challenge and answers 409 VERIFICATION_CHALLENGE_EXPIRED", async () => {
    const expired = row({ challengeExpiresAt: new Date(now.getTime() - 1) });
    const { service, repository, storage } = setup({ findByIdForUser: jest.fn().mockResolvedValue(expired) });
    expect(await errorBody(service.submitSelfie(userId, verificationId, selfie)))
      .toMatchObject({ status: 409, body: { code: "VERIFICATION_CHALLENGE_EXPIRED" } });
    expect(repository.update).toHaveBeenCalledWith(verificationId, { status: "EXPIRED" });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("refuses a second selfie for the same attempt with 409", async () => {
    const { service } = setup({ findByIdForUser: jest.fn().mockResolvedValue(row({ status: "PENDING_REVIEW" })) });
    expect(await errorBody(service.submitSelfie(userId, verificationId, selfie)))
      .toMatchObject({ status: 409, body: { code: "VERIFICATION_STATE_CONFLICT" } });
  });

  it("removes the stored file if the attempt changed meanwhile", async () => {
    const findByIdForUser = jest.fn()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: "EXPIRED" }));
    const { service, storage, repository } = setup({ findByIdForUser });
    await expect(service.submitSelfie(userId, verificationId, selfie)).rejects.toThrow(HttpException);
    expect(storage.remove).toHaveBeenCalledWith("users/u/verificaciones/k.jpg");
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe("VerificationService.getMine", () => {
  it("reports NONE with no attempts", async () => {
    const { service } = setup();
    expect(await service.getMine(userId)).toEqual({
      status: "NONE", verifiedAt: null, challenge: null, lastDecision: null, canRetryAt: null,
    });
  });

  it("reports the last rejection with its reason text and when a retry is possible", async () => {
    const rejected = row({ status: "REJECTED", decidedAt: now, decisionReason: "GESTURE_MISMATCH" });
    const attempts = [1, 2, 3].map((hours) => new Date(now.getTime() - hours * 3_600_000));
    const { service } = setup({
      findLatestForUser: jest.fn().mockResolvedValue(rejected),
      findLatestDecided: jest.fn().mockResolvedValue(rejected),
      attemptDatesSince: jest.fn().mockResolvedValue(attempts),
    });
    const state = await service.getMine(userId);
    expect(state.status).toBe("REJECTED");
    expect(state.lastDecision).toMatchObject({ decision: "REJECTED", reason: "GESTURE_MISMATCH", reasonText: expect.any(String) });
    expect(state.canRetryAt).toBe("2026-11-21T09:00:00.000Z");
  });

  it("reports an approval whose photos were all removed as REVOKED", async () => {
    const approved = row({ status: "APPROVED", decidedAt: now });
    const { service } = setup({ findLatestForUser: jest.fn().mockResolvedValue(approved) });
    expect((await service.getMine(userId)).status).toBe("REVOKED");
  });

  it("shows the open challenge, or EXPIRED once its window passed", async () => {
    const open = setup({ findLatestForUser: jest.fn().mockResolvedValue(row()) });
    expect(await open.service.getMine(userId)).toMatchObject({ status: "PENDING_UPLOAD", challenge: { id: verificationId } });
    const late = setup({ findLatestForUser: jest.fn().mockResolvedValue(row({ challengeExpiresAt: now })) });
    expect(await late.service.getMine(userId)).toMatchObject({ status: "EXPIRED", challenge: null });
  });
});

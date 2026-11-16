import { ForbiddenException, HttpException, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { UserRole } from "../../common/enums/domain.enums";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { ChatMediaCipher } from "../chat/chat-media-cipher";
import { MediaStorageProvider } from "../media/media-storage.port";
import { NotificationService } from "../notifications/notification.service";
import { PhotoVerificationModel } from "./photo-verification.model";
import { SelfieLinkSigner } from "./selfie-link.signer";
import { VerificationRepository } from "./verification.repository";
import { VerificationReviewService } from "./verification-review.service";

const memberId = "00000000-0000-4000-8000-000000000001";
const verificationId = "00000000-0000-4000-8000-0000000000aa";
const now = new Date("2026-11-20T12:00:00.000Z");
const tx = { id: "tx" } as unknown as Transaction;
// A platform moderator is a member of gym-a but reviews every gym (ADR-0018).
const moderator: AuthenticatedUser = {
  id: "00000000-0000-4000-8000-0000000000ff",
  email: "mod@example.test",
  role: UserRole.MODERATOR,
  tenantId: "gym-a",
  tenantScope: "gym-a",
  impersonating: false,
};
const impersonatingAdmin: AuthenticatedUser = { ...moderator, role: UserRole.SYSTEM_ADMIN, tenantScope: "gym-b", impersonating: true };

const pending = (overrides: Partial<PhotoVerificationModel> = {}) =>
  ({
    id: verificationId,
    userId: memberId,
    gestureCode: "OPEN_PALM",
    status: "PENDING_REVIEW",
    submittedAt: now,
    selfieStorageKey: "users/m/verificaciones/k.jpg",
    selfieMimeType: "image/jpeg",
    ...overrides,
  }) as PhotoVerificationModel;

function setup(overrides: Partial<Record<keyof VerificationRepository, jest.Mock>> = {}) {
  const cipher = new ChatMediaCipher("s".repeat(64));
  const repository = {
    findByIdInScope: jest.fn().mockResolvedValue({ verification: pending(), tenantId: "gym-b" }),
    lockUser: jest.fn().mockResolvedValue({ verifiedAt: null, role: UserRole.CLIENT }),
    accountRole: jest.fn().mockResolvedValue(UserRole.CLIENT),
    visiblePhotos: jest.fn().mockResolvedValue([
      { userId: memberId, id: "p1", url: "users/m/perfiles/a.jpg" },
      { userId: memberId, id: "p2", url: "users/m/perfiles/b.jpg" },
    ]),
    update: jest.fn().mockResolvedValue(undefined),
    setUserVerifiedAt: jest.fn().mockResolvedValue(undefined),
    listQueue: jest.fn().mockResolvedValue([{ verification: pending(), memberName: "Ana", tenantId: "gym-b", tenantName: "Gimnasio B" }]),
    ...overrides,
  };
  const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
  const storage = { download: jest.fn().mockResolvedValue(cipher.encrypt(Buffer.from("jpeg-bytes"))) };
  const signer = new SelfieLinkSigner("k".repeat(64));
  const sequelize = { transaction: jest.fn(async (run: (t: Transaction) => unknown) => run(tx)) };
  const service = new VerificationReviewService(
    sequelize as unknown as Sequelize,
    repository as unknown as VerificationRepository,
    notifications as unknown as NotificationService,
    storage as unknown as MediaStorageProvider,
    cipher,
    signer,
    () => now,
  );
  return { service, repository, notifications, storage, signer };
}

describe("VerificationReviewService.decide", () => {
  it("refuses an approval when the gallery changed after the moderator looked at it", async () => {
    const { service, repository } = setup();
    // The moderator compared p1+p3; the member has p1+p2 now.
    await expect(
      service.decide(moderator, verificationId, { decision: "APPROVE", comparedPhotoIds: ["p1", "p3"] }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VERIFICATION_PHOTOS_CHANGED" }) });
    expect(repository.setUserVerifiedAt).not.toHaveBeenCalled();
  });

  it("approves in one transaction: status, reviewer, verified_at, compared photos and the member notice", async () => {
    const { service, repository, notifications } = setup();
    const result = await service.decide(moderator, verificationId, { decision: "APPROVE", comparedPhotoIds: ["p1", "p2"] });
    expect(result).toMatchObject({ submission: { id: verificationId, status: "APPROVED" }, tenantId: "gym-b", decision: "APPROVED", reason: null });
    // A moderator decides on any gym: the lookup carries no gym filter.
    expect(repository.findByIdInScope).toHaveBeenCalledWith(verificationId, null, tx);
    expect(repository.update).toHaveBeenCalledWith(
      verificationId,
      { status: "APPROVED", reviewerId: moderator.id, decisionReason: null, decidedAt: now, approvedPhotoIds: ["p1", "p2"] },
      tx,
    );
    expect(repository.setUserVerifiedAt).toHaveBeenCalledWith(memberId, now, tx);
    expect(notifications.enqueueDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: memberId,
        channel: "IN_APP",
        deduplicationKey: `verification.decided:${verificationId}`,
        metadata: expect.objectContaining({ outcome: "APPROVED" }),
      }),
      tx,
    );
  });

  it("rejects with the reason text in the notice and leaves verified_at alone", async () => {
    const { service, repository, notifications } = setup();
    const result = await service.decide(moderator, verificationId, { decision: "REJECT", reason: "GESTURE_MISMATCH" });
    expect(result).toMatchObject({ decision: "REJECTED", reason: "GESTURE_MISMATCH", tenantId: "gym-b" });
    expect(repository.update).toHaveBeenCalledWith(
      verificationId,
      { status: "REJECTED", reviewerId: moderator.id, decisionReason: "GESTURE_MISMATCH", decidedAt: now },
      tx,
    );
    expect(repository.setUserVerifiedAt).not.toHaveBeenCalled();
    const [notice] = notifications.enqueueDirectMessage.mock.calls[0];
    expect(notice.body).toContain("El gesto de la selfie no coincide");
    expect(notice.body).toContain("El equipo de REPP");
    expect(notice.body).not.toMatch(/gimnasio/iu);
  });

  it("tells the member that the REPP team approved, never the gym", async () => {
    const { service, notifications } = setup();
    await service.decide(moderator, verificationId, { decision: "APPROVE", comparedPhotoIds: ["p1", "p2"] });
    const [notice] = notifications.enqueueDirectMessage.mock.calls[0];
    expect(notice.body).toContain("El equipo de REPP");
    expect(notice.body).not.toMatch(/gimnasio/iu);
  });

  it("keeps a SYSTEM_ADMIN impersonating a gym inside that gym", async () => {
    const { service, repository } = setup({ findByIdInScope: jest.fn().mockResolvedValue(null) });
    await expect(service.decide(impersonatingAdmin, verificationId, { decision: "REJECT", reason: "OTHER" })).rejects.toThrow(NotFoundException);
    expect(repository.findByIdInScope).toHaveBeenCalledWith(verificationId, "gym-b", tx);
  });

  it("answers 404 for a verification outside the actor's scope", async () => {
    const { service, repository } = setup({ findByIdInScope: jest.fn().mockResolvedValue(null) });
    await expect(service.decide(moderator, verificationId, { decision: "APPROVE", comparedPhotoIds: ["p1", "p2"] })).rejects.toThrow(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("answers 409 when the attempt is not waiting for review", async () => {
    const { service } = setup({
      findByIdInScope: jest.fn().mockResolvedValue({ verification: pending({ status: "APPROVED" }), tenantId: "gym-b" }),
    });
    await expect(service.decide(moderator, verificationId, { decision: "REJECT", reason: "OTHER" }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("does not approve against an empty gallery", async () => {
    const { service, repository } = setup({ visiblePhotos: jest.fn().mockResolvedValue([]) });
    await expect(service.decide(moderator, verificationId, { decision: "APPROVE", comparedPhotoIds: ["p1", "p2"] })).rejects.toThrow(HttpException);
    expect(repository.setUserVerifiedAt).not.toHaveBeenCalled();
  });
});

describe("VerificationReviewService queue and selfie", () => {
  it("lists with the gesture, the member photos and a signed link bound to the moderator", async () => {
    const { service, repository, signer } = setup();
    const [item] = await service.listQueue(moderator, { status: "PENDING_REVIEW", limit: 20 });
    // Cross-gym queue for a moderator; each item names its gym.
    expect(repository.listQueue).toHaveBeenCalledWith("PENDING_REVIEW", 20, null, { id: moderator.id, seesPlatformAccounts: false });
    expect(item).toMatchObject({
      id: verificationId,
      member: { id: memberId, name: "Ana" },
      tenantId: "gym-b",
      tenantName: "Gimnasio B",
      gesture: { code: "OPEN_PALM" },
      profilePhotos: [{ id: "p1" }, { id: "p2" }],
    });
    const url = new URL(item.selfie!.url, "http://api.test");
    expect(url.pathname).toBe(`/${env.API_PREFIX}/admin/verifications/${verificationId}/selfie`);
    const expires = Number(url.searchParams.get("expires"));
    expect(expires).toBe(now.getTime() + 5 * 60 * 1000);
    expect(signer.isValid(verificationId, moderator.id, expires, url.searchParams.get("signature")!, now)).toBe(true);
    expect(JSON.stringify(item)).not.toContain("verificaciones/k.jpg");
  });

  it("serves the decrypted selfie only with a valid link", async () => {
    const { service, signer, storage } = setup();
    const expires = now.getTime() + 60_000;
    const media = await service.readSelfie(moderator, verificationId, {
      expires,
      signature: signer.sign(verificationId, moderator.id, new Date(expires)),
    });
    expect(media).toEqual({ buffer: Buffer.from("jpeg-bytes"), mimeType: "image/jpeg" });
    await expect(service.readSelfie(moderator, verificationId, { expires, signature: "A".repeat(43) }))
      .rejects.toThrow(ForbiddenException);
    expect(storage.download).toHaveBeenCalledTimes(1);
  });

  it("reads the selfie of any gym for a moderator and only the impersonated gym for a SYSTEM_ADMIN", async () => {
    const { service, signer, repository } = setup();
    const expires = now.getTime() + 60_000;
    await service.readSelfie(moderator, verificationId, { expires, signature: signer.sign(verificationId, moderator.id, new Date(expires)) });
    expect(repository.findByIdInScope).toHaveBeenLastCalledWith(verificationId, null);
    await service.listQueue(impersonatingAdmin, { status: "PENDING_REVIEW", limit: 20 });
    expect(repository.listQueue).toHaveBeenLastCalledWith("PENDING_REVIEW", 20, "gym-b", { id: impersonatingAdmin.id, seesPlatformAccounts: true });
  });
});

describe("VerificationReviewService: nobody reviews their own or a platform account's selfie (ADR-0018 §8)", () => {
  const code = (error: unknown) => (error as { response?: { code?: string } }).response?.code;

  it("refuses a moderator deciding its own verification, before writing anything", async () => {
    const { service, repository } = setup({
      findByIdInScope: jest.fn().mockResolvedValue({ verification: pending({ userId: moderator.id }), tenantId: "gym-a" }),
      lockUser: jest.fn().mockResolvedValue({ verifiedAt: null, role: UserRole.MODERATOR }),
    });
    const error = await service.decide(moderator, verificationId, { decision: "APPROVE", comparedPhotoIds: ["p1", "p2"] }).catch((caught: unknown) => caught);
    expect(code(error)).toBe("MODERATION_SELF_CASE");
    expect((error as HttpException).getStatus()).toBe(403);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.setUserVerifiedAt).not.toHaveBeenCalled();
  });

  it("refuses a moderator deciding another moderator's verification; a SYSTEM_ADMIN may", async () => {
    const peer = { verifiedAt: null, role: UserRole.MODERATOR };
    const refused = setup({ lockUser: jest.fn().mockResolvedValue(peer) });
    const error = await refused.service.decide(moderator, verificationId, { decision: "REJECT", reason: "OTHER" }).catch((caught: unknown) => caught);
    expect(code(error)).toBe("MODERATION_PEER_CASE");
    expect(refused.repository.update).not.toHaveBeenCalled();

    const allowed = setup({ lockUser: jest.fn().mockResolvedValue(peer) });
    await expect(allowed.service.decide(impersonatingAdmin, verificationId, { decision: "REJECT", reason: "OTHER" })).resolves.toMatchObject({ decision: "REJECTED" });
  });

  it("does not open the selfie of a platform account for a moderator", async () => {
    const { service, signer, storage } = setup({ accountRole: jest.fn().mockResolvedValue(UserRole.SYSTEM_ADMIN) });
    const expires = now.getTime() + 60_000;
    const error = await service
      .readSelfie(moderator, verificationId, { expires, signature: signer.sign(verificationId, moderator.id, new Date(expires)) })
      .catch((caught: unknown) => caught);
    expect(code(error)).toBe("MODERATION_PEER_CASE");
    expect(storage.download).not.toHaveBeenCalled();
  });
});

import { CHAT_EVIDENCE_RETENTION_DAYS, ModerationEvidenceService } from "./moderation-evidence.service";
import {
  MINOR_ACCOUNT_CLOSURE_QUEUE,
  ModerationMinorService,
  PENDING_REVIEW_SUSPENSION_UNTIL,
} from "./moderation-minor.service";
import { REASON_NOTICE, sanctionNotice } from "./moderation-notices";
import { ModerationReason, nextSanction, STRIKE_LIFETIME_DAYS } from "./moderation.policy";

const transaction = { id: "tx" };

describe("ModerationMinorService", () => {
  function build(suspended: boolean) {
    const repository = {
      suspendMemberUntil: jest.fn().mockResolvedValue(suspended),
      liftProvisionalSuspension: jest.fn().mockResolvedValue(undefined),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
    const service = new ModerationMinorService(repository as never, outbox as never, notifications as never);
    return { service, repository, outbox, notifications };
  }

  it("suspends until a moderator decides and tells the person why, in the report transaction", async () => {
    const { service, repository, notifications } = build(true);
    await expect(service.suspendPendingReview("user-1", transaction as never)).resolves.toBe(true);
    expect(repository.suspendMemberUntil).toHaveBeenCalledWith("user-1", PENDING_REVIEW_SUSPENSION_UNTIL, transaction);
    expect(PENDING_REVIEW_SUSPENSION_UNTIL.getUTCFullYear()).toBe(9999);
    const [notice, tx] = notifications.enqueueDirectMessage.mock.calls[0] as [{ body: string; recipientUserId: string }, unknown];
    expect(notice.recipientUserId).toBe("user-1");
    expect(notice.body).toContain("Menor de edad");
    expect(tx).toBe(transaction);
  });

  it("does not notify when nothing was suspended (staff account or already suspended)", async () => {
    const { service, notifications } = build(false);
    await expect(service.suspendPendingReview("staff-1", transaction as never)).resolves.toBe(false);
    expect(notifications.enqueueDirectMessage).not.toHaveBeenCalled();
  });

  it("requests the account closure through the outbox when a minor is confirmed", async () => {
    const { service, outbox } = build(false);
    await service.confirm("user-1", transaction as never);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: MINOR_ACCOUNT_CLOSURE_QUEUE,
        aggregateId: "user-1",
        deduplicationKey: "account-minor-closure:user-1",
        payload: { schemaVersion: 1, userId: "user-1" },
      }),
      transaction,
    );
  });
});

describe("ModerationEvidenceService.purgeExpired", () => {
  it("deletes copies closed more than the retention ago and releases their orphan files", async () => {
    const repository = {
      deleteExpiredChatEvidence: jest.fn().mockResolvedValue({
        deleted: 1,
        orphanMedia: [{ messageId: "m-1", provider: "local", storageKey: "k" }],
      }),
    };
    const mediaRelease = { requestRelease: jest.fn().mockResolvedValue(undefined) };
    const sequelize = { transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(transaction)) };
    const service = new ModerationEvidenceService(sequelize as never, repository as never, mediaRelease as never);
    const now = new Date("2027-06-01T00:00:00.000Z");

    await expect(service.purgeExpired(now)).resolves.toBe(1);
    const [cutoff] = repository.deleteExpiredChatEvidence.mock.calls[0] as [Date];
    expect(now.getTime() - cutoff.getTime()).toBe(CHAT_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(mediaRelease.requestRelease).toHaveBeenCalledWith(
      { aggregateType: "moderation.chat_evidence", aggregateId: "m-1", provider: "local", storageKey: "k" },
      transaction,
    );
  });
});

describe("moderation notices", () => {
  it("names the reason category and its short text in every sanction notice", () => {
    for (const reason of Object.values(ModerationReason)) {
      for (const strikes of [0, 1, 5]) {
        const notice = sanctionNotice(nextSanction(strikes), reason, { kind: "STORY", id: "s-1" });
        expect(notice.body).toContain(`Motivo: ${REASON_NOTICE[reason].label} (${REASON_NOTICE[reason].text}).`);
        expect(notice.metadata).toMatchObject({ type: "MODERATION_SANCTION", reason });
      }
    }
  });

  it("keeps one exported counting window for sanctions", () => {
    expect(STRIKE_LIFETIME_DAYS).toBe(365);
  });
});

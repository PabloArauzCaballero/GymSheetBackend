import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { UserRole } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { canonicalEmail } from "../../common/privacy/email-hash";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { HandlesRepository } from "../business-accounts/handles.repository";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { KycCipher, assertKycAvailable } from "./kyc-cipher";
import { KycAccountRow, KycEffectsRepository } from "./kyc-effects.repository";
import { KycNotices } from "./kyc-notices";
import { KYC_CLOCK, KycClock } from "./kyc-pipeline.service";
import { KycReviewRepository, QueueRow } from "./kyc-review.repository";
import { assertKycTransition } from "./kyc-state-machine";
import { KYC_RULES, KycRejectionReason, KycStatus } from "./kyc.catalog";
import { mapDocument, mapSubmission } from "./kyc.mapper";
import { KycRepository, SubmissionRow } from "./kyc.repository";
import type { KycDecisionInput, KycQueueQuery } from "./kyc.schemas";

export type KycQueuePage = {
  items: (Omit<QueueRow, "submittedAt" | "dueAt" | "claimedAt"> & { submittedAt: string; dueAt: string; overdue: boolean; claimedAt: string | null })[];
  nextCursor: string | null;
};

function encodeCursor(row: QueueRow): string {
  return Buffer.from(`${new Date(row.dueAt).toISOString()}|${row.submissionId}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): { dueAt: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const dueAt = new Date(at ?? "");
  return Number.isNaN(dueAt.getTime()) || !/^[0-9a-f-]{36}$/u.test(id ?? "") ? null : { dueAt, id };
}

/**
 * REPP's KYC console (plan §2.7), run by the central team
 * (`PLATFORM_MODERATION_ROLES`): the two queues, the detail with the data in
 * clear, the document viewer, claim/release and the decision. Nobody reviews
 * their own business (ADR-0018 §8): the actor's account, or a business whose
 * email is the actor's own mailbox (same canonical HMAC), is refused.
 */
@Injectable()
export class KycReviewService {
  private readonly logger = new Logger(KycReviewService.name);

  constructor(
    private readonly repository: KycRepository,
    private readonly review: KycReviewRepository,
    private readonly effects: KycEffectsRepository,
    private readonly handles: HandlesRepository,
    private readonly notices: KycNotices,
    private readonly cipher: KycCipher,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    @Inject(KYC_CLOCK) private readonly clock: KycClock,
  ) {}

  async queue(query: KycQueueQuery): Promise<KycQueuePage> {
    const now = this.clock();
    const rows = await this.review.listQueue(
      { queue: query.queue, entityType: query.entityType, overdue: query.overdue, after: decodeCursor(query.cursor), limit: query.limit + 1 },
      now,
    );
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        ...row,
        submittedAt: new Date(row.submittedAt).toISOString(),
        dueAt: new Date(row.dueAt).toISOString(),
        overdue: new Date(row.dueAt) <= now,
        claimedAt: row.claimedAt ? new Date(row.claimedAt).toISOString() : null,
      })),
      nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  /** The submission with its identity data in clear (the controller audits the read). */
  async detail(actor: AuthenticatedUser, submissionId: string) {
    assertKycAvailable(this.cipher);
    const { submission, account } = await this.load(actor, submissionId);
    const [documents, checks, decisions, history, entity] = await Promise.all([
      this.repository.listDocuments(submission.id, undefined, true),
      this.repository.listChecks(submission.id),
      this.repository.listDecisions(submission.id),
      this.repository.listHistory(submission.id),
      this.effects.findEntity(account.entityId),
    ]);
    const handle = entity ? await this.handles.findCurrent(entity.id, this.clock()) : null;
    const decrypt = (value: Buffer | null) => (value ? this.cipher.decryptText(value) : null);
    return {
      submission: mapSubmission(submission, [], this.clock()),
      identity: { nit: decrypt(submission.nitEnc), repCiNumber: decrypt(submission.repCiEnc), phone: decrypt(submission.phoneEnc) },
      phoneVerified: Boolean(submission.phoneVerifiedAt),
      account: { id: account.userId, email: account.email, status: account.status, kycStatus: account.kycStatus, entityType: account.entityType },
      entity: entity
        ? { id: entity.id, name: entity.name, status: entity.status, isVerified: entity.isVerified, city: entity.city, logoUrl: entity.logoUrl }
        : null,
      handle,
      documents: documents.map((doc) => ({ ...mapDocument(doc), deleted: doc.deletedAt !== null, deleteReason: doc.deleteReason, selfieChallengeCode: doc.selfieChallengeCode })),
      checks: checks.map((check) => ({ ...check, createdAt: new Date(check.createdAt).toISOString() })),
      decisions: decisions.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
      history: history.map((row) => ({ ...row, at: new Date(row.at).toISOString() })),
      claimedByUserId: submission.claimedByUserId,
    };
  }

  /** Decrypted bytes of one document; the controller audits every view. */
  async readDocument(actor: AuthenticatedUser, submissionId: string, documentId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    assertKycAvailable(this.cipher);
    await this.load(actor, submissionId);
    const document = await this.repository.findDocument(submissionId, documentId);
    if (!document?.storageKey) throw new NotFoundException("Documento no encontrado.");
    const buffer = this.cipher.decrypt(await this.storage.download(document.storageKey));
    return { buffer, mimeType: document.mime };
  }

  async claim(actor: AuthenticatedUser, submissionId: string): Promise<{ claimedByUserId: string; claimedAt: string }> {
    return this.repository.runInTransaction(async (transaction) => {
      const { submission } = await this.load(actor, submissionId, transaction);
      this.assertReviewable(submission.status);
      const holder = await this.review.claim(submissionId, actor.id, new Date(this.clock().getTime() - KYC_RULES.claimTtlMs), transaction);
      if (holder !== actor.id) throw claimedByOther();
      return { claimedByUserId: actor.id, claimedAt: this.clock().toISOString() };
    });
  }

  async release(actor: AuthenticatedUser, submissionId: string): Promise<void> {
    await this.repository.runInTransaction(async (transaction) => {
      const { submission } = await this.load(actor, submissionId, transaction);
      if (!submission.claimedByUserId) throw new DomainException(HttpStatus.CONFLICT, "KYC_NOT_CLAIMED", "Nadie tomó esta solicitud.");
      if (submission.claimedByUserId !== actor.id && actor.role !== UserRole.SYSTEM_ADMIN) throw claimedByOther();
      await this.review.release(submissionId, transaction);
    });
  }

  /** APPROVE / POST_REVIEW_OK → APPROVED («Verificado por REPP»); REJECT → REJECTED, resubmittable or final. */
  async decide(actor: AuthenticatedUser, submissionId: string, input: KycDecisionInput): Promise<{ status: KycStatus; decisionId: string }> {
    const outcome = await this.repository.runInTransaction(async (transaction) => {
      const { submission, account } = await this.load(actor, submissionId, transaction, true);
      if (submission.claimedByUserId && submission.claimedByUserId !== actor.id && submission.claimedAt && submission.claimedAt > new Date(this.clock().getTime() - KYC_RULES.claimTtlMs)) {
        throw claimedByOther();
      }
      // The post-review closes an automatic approval only.
      if (input.decision === "POST_REVIEW_OK" && submission.status !== "AUTO_APPROVED") {
        throw new DomainException(HttpStatus.CONFLICT, "KYC_INVALID_TRANSITION", "Solo una aprobación automática tiene revisión posterior.", {
          from: submission.status,
          to: "APPROVED",
        });
      }
      const target: KycStatus = input.decision === "REJECT" ? "REJECTED" : "APPROVED";
      assertKycTransition(submission.status, target);
      const now = this.clock();
      const decisionId = await this.repository.insertDecision(
        {
          submissionId,
          decision: input.decision,
          actorUserId: actor.id,
          reasonCodes: input.reasonCodes,
          note: input.note ?? null,
          allowResubmit: input.decision === "REJECT" ? (input.allowResubmit ?? false) : null,
        },
        transaction,
      );
      await this.repository.updateSubmission(
        submissionId,
        {
          status: target,
          decided_at: now,
          claimed_by_user_id: null,
          claimed_at: null,
          ...(input.decision === "REJECT" ? { allow_resubmit: input.allowResubmit ?? false } : {}),
        },
        transaction,
      );
      await this.repository.insertHistory(
        { accountId: account.userId, submissionId, from: submission.status, to: target, decisionId, actorUserId: actor.id },
        transaction,
      );
      if (target === "APPROVED") await this.applyApproval(account, submission, decisionId, transaction);
      else await this.applyRejection(account, submission, decisionId, input.reasonCodes, input.allowResubmit ?? false, now, transaction);
      return { status: target, decisionId };
    });
    this.logger.log({ event: "kyc.decided", submissionId, decision: input.decision, reviewerId: actor.id });
    return outcome;
  }

  private async applyApproval(account: KycAccountRow, submission: SubmissionRow, decisionId: string, transaction: Transaction): Promise<void> {
    const entity = await this.effects.findEntity(account.entityId, transaction);
    if (!entity) throw new NotFoundException("Negocio no encontrado.");
    if (submission.purpose === "MATERIAL_CHANGE") await this.effects.applyMaterialChange(entity, submission, transaction);
    await this.effects.publish(entity, true, transaction);
    await this.effects.updateAccount(
      account.userId,
      { status: "ACTIVE", kyc_status: "APPROVED", current_submission_id: submission.id, suspension_reason_code: null, suspended_at: null },
      { firstApproval: true, humanVerification: true },
      transaction,
    );
    const handle = await this.handles.findCurrent(entity.id, this.clock(), transaction);
    await this.notices.send(account.userId, decisionId, { kind: "APPROVED", handle: submission.purpose === "MATERIAL_CHANGE" ? null : (handle?.handle ?? null) }, transaction);
  }

  private async applyRejection(
    account: KycAccountRow,
    submission: SubmissionRow,
    decisionId: string,
    reasons: readonly KycRejectionReason[],
    allowResubmit: boolean,
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    const materialChange = submission.purpose === "MATERIAL_CHANGE";
    // A rejected change leaves the approved version, and the public listing, as they were.
    if (!materialChange) {
      const entity = await this.effects.findEntity(account.entityId, transaction);
      if (!entity) throw new NotFoundException("Negocio no encontrado.");
      if (allowResubmit) {
        await this.effects.unpublish(entity, transaction);
        await this.effects.updateAccount(account.userId, { status: "ONBOARDING", kyc_status: "REJECTED" }, {}, transaction);
      } else {
        await this.effects.setEntityStatus(entity, "SUSPENDED", false, transaction);
        await this.effects.releaseHandle(entity.id, now, transaction);
        await this.effects.updateAccount(
          account.userId,
          { status: "SUSPENDED", kyc_status: "REJECTED", suspension_reason_code: "KYC_REJECTED", suspended_at: now },
          {},
          transaction,
        );
      }
    }
    await this.notices.send(account.userId, decisionId, { kind: "REJECTED", reasons, allowResubmit, materialChange }, transaction);
  }

  /** The submission and its account, 404 when absent, 403 when the actor would review their own business. */
  async load(actor: AuthenticatedUser, submissionId: string, transaction?: Transaction, lock = false): Promise<{ submission: SubmissionRow; account: KycAccountRow }> {
    const submission = await this.repository.findSubmission(submissionId, transaction, lock);
    if (!submission) throw new NotFoundException("Solicitud no encontrada.");
    const account = await this.effects.findAccount(submission.accountId, transaction, lock);
    if (!account) throw new NotFoundException("Solicitud no encontrada.");
    assertNotOwnBusiness(actor, account, this.logger);
    return { submission, account };
  }

  private assertReviewable(status: KycStatus): void {
    if (status !== "IN_REVIEW" && status !== "AUTO_APPROVED") assertKycTransition(status, "APPROVED");
  }
}

function claimedByOther(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, "KYC_CLAIMED_BY_OTHER", "Otro moderador está revisando esta solicitud.");
}

/** ADR-0018 §8 for businesses: the actor's own account, or a business registered with the actor's own mailbox. */
export function assertNotOwnBusiness(actor: AuthenticatedUser, account: Pick<KycAccountRow, "userId" | "email">, logger?: Logger): void {
  const sameMailbox = canonicalEmail(actor.email) === canonicalEmail(account.email);
  if (actor.id !== account.userId && !sameMailbox) return;
  logger?.warn({ event: "kyc.review_refused", code: "MODERATION_SELF_CASE", reviewerId: actor.id });
  throw new DomainException(HttpStatus.FORBIDDEN, "MODERATION_SELF_CASE", "No puedes revisar tu propio negocio.");
}

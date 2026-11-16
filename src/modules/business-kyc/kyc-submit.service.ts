import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { DomainException } from "../../common/errors/domain.exception";
import { HandlesRepository } from "../business-accounts/handles.repository";
import { DirectoryEntityModel } from "../directory/directory-entity.model";
import { ImageModerationService } from "./image-moderation/image-moderation.service";
import { KycCheckContext } from "./kyc-checks";
import { FingerprintKind, KycCipher, assertKycAvailable, kycFingerprint } from "./kyc-cipher";
import { KycDraftsService } from "./kyc-drafts.service";
import { KycAccountRow, KycEffectsRepository } from "./kyc-effects.repository";
import { KycNotices } from "./kyc-notices";
import { CheckRecord, KYC_CLOCK, KycClock, KycPipelineService, decidePipeline } from "./kyc-pipeline.service";
import { postReviewDueAt, reviewDueAt } from "./kyc-sla";
import { KYC_RULES, REQUIRED_DOCUMENTS, USER_FACING_CHECKS } from "./kyc.catalog";
import { DocumentRow, KycRepository, SubmissionRow } from "./kyc.repository";
import { PhoneVerificationService } from "./phone/phone-verification.service";

export type KycSubmitResult = {
  submissionId: string;
  status: "AUTO_APPROVED" | "IN_REVIEW";
  reviewDueAt: string | null;
  postReviewDueAt: string | null;
  /** Checks that sent it to review and that the business may read (never the blocklist). */
  userFacingCodes: string[];
  handle: string | null;
};

/** What the submit cannot go without (422 KYC_INCOMPLETE `{ missing }`). */
export function missingForSubmit(input: {
  account: KycAccountRow;
  entity: DirectoryEntityModel;
  submission: SubmissionRow;
  documents: readonly DocumentRow[];
  hasHandle: boolean;
  hasPhone: boolean;
}): string[] {
  const { account, entity, submission } = input;
  const missing: string[] = [];
  if (!account.emailVerifiedAt) missing.push("EMAIL_VERIFIED");
  if (!input.hasHandle) missing.push("HANDLE");
  if (submission.purpose === "MATERIAL_CHANGE" ? !submission.primaryCategoryId : !entity.primaryCategoryId) missing.push("CATEGORY");
  if (!entity.city) missing.push("CITY");
  if (!input.hasPhone) missing.push("PHONE");
  if (!submission.repFullName) missing.push("REP_FULL_NAME");
  if (!submission.repCiHmac) missing.push("REP_CI");
  if (account.legalKind === "COMPANY") {
    if (!submission.legalName) missing.push("LEGAL_NAME");
    if (!submission.nitHmac) missing.push("NIT");
    if (!submission.address) missing.push("ADDRESS");
    if (!entity.logoUrl) missing.push("LOGO");
  } else if (!submission.specialty) {
    missing.push("SPECIALTY");
  }
  const present = new Set(input.documents.map((doc) => doc.kind));
  for (const kind of REQUIRED_DOCUMENTS[account.legalKind]) if (!present.has(kind)) missing.push(`DOCUMENT_${kind}`);
  return missing;
}

/**
 * `POST /business/me/kyc/submit` and the versions that follow it (plan §2.5,
 * §2.6). The pipeline runs synchronously; its result (checks, decision,
 * history, listing and handle, notices, image moderation job) commits in ONE
 * transaction. Advisory locks per identity HMAC serialize submits that share a
 * NIT, CI or phone, so two of them can never both approve themselves.
 */
@Injectable()
export class KycSubmitService {
  private readonly logger = new Logger(KycSubmitService.name);

  constructor(
    private readonly repository: KycRepository,
    private readonly effects: KycEffectsRepository,
    private readonly drafts: KycDraftsService,
    private readonly handles: HandlesRepository,
    private readonly phones: PhoneVerificationService,
    private readonly pipeline: KycPipelineService,
    private readonly imageModeration: ImageModerationService,
    private readonly notices: KycNotices,
    private readonly cipher: KycCipher,
    @Inject(KYC_CLOCK) private readonly clock: KycClock,
  ) {}

  async submit(userId: string): Promise<KycSubmitResult> {
    assertKycAvailable(this.cipher);
    const started = Date.now();
    const result = await this.repository.runInTransaction(async (transaction) => {
      const account = await this.drafts.requireAccount(userId, transaction, true);
      const draft = await this.repository.findOpen(userId, transaction, true);
      if (!draft) throw new DomainException(HttpStatus.CONFLICT, "KYC_NOT_EDITABLE", "No tienes una solicitud por enviar.", { action: "CHANGE" });
      if (draft.status !== "DRAFT") throw new DomainException(HttpStatus.CONFLICT, "KYC_NOT_EDITABLE", "Tu solicitud ya está en revisión.", { action: "WAIT" });
      const entity = await this.effects.findEntity(account.entityId, transaction);
      if (!entity) throw new NotFoundException("Negocio no encontrado.");
      const now = this.clock();
      const handle = await this.handles.findCurrent(entity.id, now, transaction);
      const phone = await this.phones.latestForSubmit(userId, transaction);
      const documents = await this.repository.listDocuments(draft.id, transaction);
      const missing = missingForSubmit({ account, entity, submission: draft, documents, hasHandle: Boolean(handle), hasPhone: Boolean(phone) });
      if (missing.length > 0) {
        throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, "KYC_INCOMPLETE", "Faltan datos para enviar la verificación.", { missing });
      }
      const fingerprints = this.fingerprints(account, draft, phone?.phoneHmac ?? null);
      // Before the statement timeout of the checks: waiting for a concurrent submit is not a slow check.
      await this.repository.lockFingerprints(Object.values(fingerprints), transaction);
      const materialChange = draft.purpose === "MATERIAL_CHANGE";
      await this.repository.updateSubmission(
        draft.id,
        {
          status: "SUBMITTED",
          submitted_at: now,
          phone_masked: phone?.phoneMasked ?? null,
          phone_enc: phone?.phoneEnc ?? null,
          phone_hmac: phone?.phoneHmac ?? null,
          phone_verified_at: phone?.verifiedAt ?? null,
          ...(materialChange ? {} : { trade_name: entity.name, primary_category_id: entity.primaryCategoryId }),
        },
        transaction,
      );
      await this.repository.insertHistory(
        { accountId: userId, submissionId: draft.id, from: "DRAFT", to: "SUBMITTED", decisionId: null, actorUserId: userId },
        transaction,
      );
      const context: KycCheckContext = {
        submissionId: draft.id,
        accountId: userId,
        entityId: entity.id,
        entityType: account.entityType,
        legalKind: account.legalKind,
        purpose: draft.purpose,
        tradeName: materialChange ? (draft.tradeName ?? entity.name) : entity.name,
        handle: handle?.handle ?? "",
        description: entity.description ?? "",
        signupRisk: account.signupRisk,
        phoneVerified: Boolean(phone?.verifiedAt),
        documents,
        fingerprints,
      };
      const records = await this.pipeline.run(context, transaction);
      if (materialChange) records.push({ code: "MATERIAL_CHANGE", outcome: "WARN", detail: {}, durationMs: 0 });
      await this.repository.recordFingerprints(userId, fingerprints, transaction);
      return this.applyDecision({ account, entity, draft, records, handle: handle?.handle ?? null, now, materialChange }, transaction);
    });
    this.logger.log({ event: "kyc.submitted", submissionId: result.submissionId, status: result.status, durationMs: Date.now() - started });
    return result;
  }

  private fingerprints(account: KycAccountRow, draft: SubmissionRow, phoneHmac: string | null): Partial<Record<FingerprintKind, string>> {
    return {
      ...(draft.nitHmac ? { NIT: draft.nitHmac } : {}),
      ...(draft.repCiHmac ? { CI: draft.repCiHmac } : {}),
      ...(phoneHmac ? { PHONE: phoneHmac } : {}),
      EMAIL: kycFingerprint("EMAIL", account.email),
    };
  }

  private async applyDecision(
    input: { account: KycAccountRow; entity: DirectoryEntityModel; draft: SubmissionRow; records: CheckRecord[]; handle: string | null; now: Date; materialChange: boolean },
    transaction: Transaction,
  ): Promise<KycSubmitResult> {
    const { account, entity, draft, records, now } = input;
    const decision = decidePipeline(records, input.materialChange);
    const failing = records.filter((record) => record.outcome !== "PASS").map((record) => record.code);
    await this.repository.insertChecks(draft.id, records, transaction);
    const decisionId = await this.repository.insertDecision(
      { submissionId: draft.id, decision, actorUserId: null, reasonCodes: failing, note: null, allowResubmit: null },
      transaction,
    );
    const status = decision === "AUTO_APPROVE" ? "AUTO_APPROVED" : "IN_REVIEW";
    const review = status === "IN_REVIEW" ? reviewDueAt(now) : null;
    const postReview = status === "AUTO_APPROVED" ? postReviewDueAt(now) : null;
    await this.repository.updateSubmission(
      draft.id,
      { status, ...(status === "AUTO_APPROVED" ? { decided_at: now } : {}), review_due_at: review, post_review_due_at: postReview },
      transaction,
    );
    await this.repository.insertHistory(
      { accountId: account.userId, submissionId: draft.id, from: "SUBMITTED", to: status, decisionId, actorUserId: null },
      transaction,
    );
    if (!input.materialChange) {
      await this.effects.updateAccount(
        account.userId,
        { kyc_status: status, ...(status === "AUTO_APPROVED" ? { status: "ACTIVE", current_submission_id: draft.id } : {}) },
        { firstApproval: status === "AUTO_APPROVED" },
        transaction,
      );
    }
    if (status === "AUTO_APPROVED") await this.effects.publish(entity, false, transaction);
    if (entity.logoUrl) await this.imageModeration.requestLogoModeration(draft.id, entity.logoUrl, transaction);
    await this.notices.send(
      account.userId,
      decisionId,
      status === "AUTO_APPROVED" ? { kind: "AUTO_APPROVED", handle: input.handle ?? "" } : { kind: "IN_REVIEW", reviewDueAt: review ?? now },
      transaction,
    );
    return {
      submissionId: draft.id,
      status,
      reviewDueAt: review?.toISOString() ?? null,
      postReviewDueAt: postReview?.toISOString() ?? null,
      userFacingCodes: failing.filter((code) => USER_FACING_CHECKS.has(code)),
      handle: input.handle,
    };
  }

  /** A new version after a rejection that allows it: at most 3 attempts, 24 h after the decision. */
  async resubmit(userId: string): Promise<{ submissionId: string; version: number }> {
    return this.repository.runInTransaction(async (transaction) => {
      const account = await this.drafts.requireAccount(userId, transaction, true);
      const latest = await this.repository.findLatest(userId, transaction);
      if (!latest || latest.status !== "REJECTED" || latest.purpose === "MATERIAL_CHANGE" || latest.allowResubmit !== true) {
        throw resubmitNotAllowed("NOT_REJECTED_WITH_RESUBMIT");
      }
      if ((await this.repository.countSentAttempts(userId, transaction)) >= KYC_RULES.maxAttempts) throw resubmitNotAllowed("MAX_ATTEMPTS");
      this.assertCooldown(latest);
      const id = await this.repository.insertSubmission(
        { accountId: userId, purpose: "RESUBMISSION", legalKind: account.legalKind, copyFrom: latest.id },
        transaction,
      );
      await this.repository.copyDocuments(latest.id, id, false, transaction);
      await this.effects.updateAccount(userId, { kyc_status: "DRAFT" }, {}, transaction);
      return { submissionId: id, version: latest.version + 1 };
    });
  }

  /**
   * A material change of an approved business (name, category, legal name,
   * NIT, representative): a new version starting from the approved data. The
   * approved version stays in force until REPP approves the new one; it never
   * approves itself.
   */
  async startChange(userId: string): Promise<{ submissionId: string; version: number }> {
    return this.repository.runInTransaction(async (transaction) => {
      const account = await this.drafts.requireAccount(userId, transaction, true);
      if (!account.currentSubmissionId || !["AUTO_APPROVED", "APPROVED"].includes(account.kycStatus)) {
        throw new DomainException(HttpStatus.CONFLICT, "KYC_CHANGE_NOT_ALLOWED", "Solo un negocio verificado puede pedir un cambio.");
      }
      if (await this.repository.findOpen(userId, transaction, true)) {
        throw new DomainException(HttpStatus.CONFLICT, "KYC_NOT_EDITABLE", "Ya tienes una solicitud abierta.", { action: "WAIT" });
      }
      const latest = await this.repository.findLatest(userId, transaction);
      if (latest?.status === "REJECTED") {
        if (latest.allowResubmit === false) throw new DomainException(HttpStatus.CONFLICT, "KYC_CHANGE_NOT_ALLOWED", "REPP no admite otra solicitud de cambio.");
        this.assertCooldown(latest);
      }
      const id = await this.repository.insertSubmission(
        { accountId: userId, purpose: "MATERIAL_CHANGE", legalKind: account.legalKind, copyFrom: account.currentSubmissionId },
        transaction,
      );
      // The approved selfie travels with the change; REPP asks for another if the representative changes.
      await this.repository.copyDocuments(account.currentSubmissionId, id, true, transaction);
      const created = await this.repository.findSubmission(id, transaction);
      return { submissionId: id, version: created?.version ?? 0 };
    });
  }

  private assertCooldown(latest: SubmissionRow): void {
    const retryAt = new Date((latest.decidedAt ?? latest.updatedAt).getTime() + KYC_RULES.resubmitCooldownMs);
    if (retryAt > this.clock()) {
      throw new DomainException(HttpStatus.CONFLICT, "KYC_RESUBMIT_COOLDOWN", "Podrás enviar una nueva solicitud 24 horas después de la decisión.", {
        retryAt: retryAt.toISOString(),
      });
    }
  }
}

function resubmitNotAllowed(reason: "NOT_REJECTED_WITH_RESUBMIT" | "MAX_ATTEMPTS"): DomainException {
  return new DomainException(HttpStatus.CONFLICT, "KYC_RESUBMIT_NOT_ALLOWED", "No puedes volver a enviar la verificación.", { reason });
}

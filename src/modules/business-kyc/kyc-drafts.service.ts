import { BadRequestException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Transaction } from "sequelize";
import { DomainException } from "../../common/errors/domain.exception";
import { assertBusinessNameAllowed } from "../business-accounts/business-name";
import { BusinessAccountsRepository } from "../business-accounts/business-accounts.repository";
import { ConsentsService } from "../consents/consents.service";
import { MediaReleaseService } from "../media/media-release.service";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { UploadedSelfie } from "../verification/selfie-image";
import { pickGesture } from "../verification/verification.catalog";
import { KycEffectsRepository, KycAccountRow } from "./kyc-effects.repository";
import { KycCipher, assertKycAvailable, kycFingerprint } from "./kyc-cipher";
import { measureKycDocument } from "./kyc-document-image";
import { ciFingerprintValue, maskTail, normalizeNit, parseCi } from "./kyc-formats";
import { KYC_RULES, KycDocumentKind } from "./kyc.catalog";
import { KYC_CLOCK, KycClock } from "./kyc-pipeline.service";
import { KycDocumentDto, mapDocument, mapSubmission, KycSubmissionDto } from "./kyc.mapper";
import { KycRepository, SubmissionPatch, SubmissionRow } from "./kyc.repository";
import type { KycDraftInput } from "./kyc.schemas";

export const KYC_DOCUMENT_AGGREGATE = "business.kyc_documents";

/** Fields that only exist for one legal kind, or only in a material change. */
const COMPANY_ONLY = ["legalName", "nit", "seprecNumber"] as const;
const INDIVIDUAL_ONLY = ["specialty"] as const;
const CHANGE_ONLY = ["tradeName", "primaryCategoryId"] as const;

function fieldInvalid(field: string, reason: "FORMAT" | "NOT_APPLICABLE" | "INCOMPLETE"): DomainException {
  const message = reason === "NOT_APPLICABLE" ? "Ese dato no corresponde a tu tipo de negocio." : "Revisa el formato de ese dato.";
  return new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, "KYC_FIELD_INVALID", message, { field, reason });
}

function notEditable(action: "RESUBMIT" | "CHANGE" | "WAIT"): DomainException {
  return new DomainException(
    HttpStatus.CONFLICT,
    "KYC_NOT_EDITABLE",
    action === "WAIT" ? "Tu solicitud ya está en revisión." : "Tu verificación no se puede editar en este estado.",
    { action },
  );
}

/**
 * The business editing its KYC attempt, step by step (plan §4.1, steps 5–6):
 * draft fields, documents with their readability, the selfie gesture and its
 * consent. Only a DRAFT is editable; every write re-reads it under lock.
 */
@Injectable()
export class KycDraftsService {
  private readonly logger = new Logger(KycDraftsService.name);

  constructor(
    private readonly repository: KycRepository,
    private readonly effects: KycEffectsRepository,
    private readonly accounts: BusinessAccountsRepository,
    private readonly cipher: KycCipher,
    private readonly consents: ConsentsService,
    private readonly mediaRelease: MediaReleaseService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    @Inject(KYC_CLOCK) private readonly clock: KycClock,
  ) {}

  async requireAccount(userId: string, transaction?: Transaction, lock = false): Promise<KycAccountRow> {
    const account = await this.effects.findAccount(userId, transaction, lock);
    if (!account) throw new NotFoundException("Cuenta de negocio no encontrada.");
    if (account.status === "SUSPENDED" || account.status === "CLOSED") {
      throw new DomainException(HttpStatus.CONFLICT, "BUSINESS_ACCOUNT_LOCKED", "Tu negocio no se puede editar en este estado.");
    }
    return account;
  }

  /** The DRAFT being edited; the first one is created on the first write. */
  async lockDraft(account: KycAccountRow, transaction: Transaction): Promise<SubmissionRow> {
    const open = await this.repository.findOpen(account.userId, transaction, true);
    if (open) {
      if (open.status !== "DRAFT") throw notEditable("WAIT");
      return open;
    }
    const latest = await this.repository.findLatest(account.userId, transaction);
    if (latest) throw notEditable(latest.status === "REJECTED" ? "RESUBMIT" : "CHANGE");
    const id = await this.repository.insertSubmission(
      { accountId: account.userId, purpose: "INITIAL", legalKind: account.legalKind, copyFrom: null },
      transaction,
    );
    const created = await this.repository.findSubmission(id, transaction, true);
    if (!created) throw new NotFoundException("Solicitud no encontrada.");
    return created;
  }

  async saveDraft(userId: string, input: KycDraftInput): Promise<KycSubmissionDto> {
    assertKycAvailable(this.cipher);
    const account = await this.requireAccount(userId);
    const saved = await this.repository.runInTransaction(async (transaction) => {
      const draft = await this.lockDraft(account, transaction);
      const patch = await this.buildPatch(account, draft, input, transaction);
      await this.repository.updateSubmission(draft.id, patch, transaction);
      return this.repository.findSubmission(draft.id, transaction);
    });
    if (!saved) throw new NotFoundException("Solicitud no encontrada.");
    return mapSubmission(saved, await this.repository.listDocuments(saved.id), this.clock());
  }

  private async buildPatch(account: KycAccountRow, draft: SubmissionRow, input: KycDraftInput, transaction: Transaction): Promise<SubmissionPatch> {
    const notApplicable = [
      ...(account.legalKind === "INDIVIDUAL" ? COMPANY_ONLY : INDIVIDUAL_ONLY),
      ...(draft.purpose === "MATERIAL_CHANGE" ? [] : CHANGE_ONLY),
    ].find((field) => input[field] !== undefined);
    if (notApplicable) throw fieldInvalid(notApplicable, "NOT_APPLICABLE");

    const patch: SubmissionPatch = {
      legal_name: input.legalName,
      rep_full_name: input.repFullName,
      specialty: input.specialty,
      address: input.address,
      seprec_number: input.seprecNumber,
    };
    if (input.nit !== undefined) Object.assign(patch, this.nitPatch(input.nit));
    if (input.repCiNumber !== undefined || input.repCiComplement !== undefined || input.repCiExtension !== undefined) {
      Object.assign(patch, this.ciPatch(draft, input));
    }
    if (input.tradeName !== undefined) {
      await assertBusinessNameAllowed(this.accounts, input.tradeName, account.entityType, account.entityId, transaction);
      patch.trade_name = input.tradeName;
    }
    if (input.primaryCategoryId !== undefined) {
      if (!(await this.accounts.categoryFits(input.primaryCategoryId, account.entityType))) {
        throw new BadRequestException("Esa categoría no corresponde a tu tipo de negocio.");
      }
      patch.primary_category_id = input.primaryCategoryId;
    }
    return patch;
  }

  private nitPatch(input: string | null): SubmissionPatch {
    if (input === null) return { nit_masked: null, nit_enc: null, nit_hmac: null };
    const nit = normalizeNit(input);
    if (!nit) throw fieldInvalid("nit", "FORMAT");
    return { nit_masked: maskTail(nit), nit_enc: this.cipher.encryptText(nit), nit_hmac: kycFingerprint("NIT", nit) };
  }

  /** Number, complement and department are validated together; the HMAC keys on the number alone (`ciFingerprintValue`). */
  private ciPatch(draft: SubmissionRow, input: KycDraftInput): SubmissionPatch {
    if (input.repCiNumber === null) {
      return { rep_ci_masked: null, rep_ci_enc: null, rep_ci_hmac: null, rep_ci_complement: null, rep_ci_extension: null };
    }
    const number = input.repCiNumber ?? (draft.repCiEnc ? this.cipher.decryptText(draft.repCiEnc) : null);
    if (!number) throw fieldInvalid("repCiNumber", "INCOMPLETE");
    const complement = input.repCiComplement !== undefined ? input.repCiComplement : draft.repCiComplement;
    const extension = input.repCiExtension !== undefined ? input.repCiExtension : draft.repCiExtension;
    const ci = parseCi(number, complement, extension);
    if (!ci) throw fieldInvalid(input.repCiNumber !== undefined ? "repCiNumber" : "repCiComplement", "FORMAT");
    return {
      rep_ci_masked: maskTail(ci.number),
      rep_ci_enc: this.cipher.encryptText(ci.number),
      rep_ci_hmac: kycFingerprint("CI", ciFingerprintValue(ci)),
      rep_ci_complement: ci.complement,
      rep_ci_extension: ci.extension,
    };
  }

  /** A random gesture for the representative's selfie; the KYC_SELFIE consent comes first (400 CONSENT_REQUIRED). */
  async issueSelfieChallenge(userId: string): Promise<{ code: string; instruction: string; expiresAt: string }> {
    assertKycAvailable(this.cipher);
    const account = await this.requireAccount(userId);
    return this.repository.runInTransaction(async (transaction) => {
      await this.consents.assertCurrentGranted(userId, "KYC_SELFIE", transaction);
      const draft = await this.lockDraft(account, transaction);
      const gesture = pickGesture(draft.selfieChallengeCode);
      const expiresAt = new Date(this.clock().getTime() + KYC_RULES.selfieChallengeTtlMs);
      await this.repository.updateSubmission(draft.id, { selfie_challenge_code: gesture.code, selfie_challenge_expires_at: expiresAt }, transaction);
      return { ...gesture, expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * Stores one photo, encrypted, in the attempt's private folder and answers
   * at once whether it can be read. Uploading a kind again replaces it (the
   * previous file is released, ADR-0017).
   */
  async uploadDocument(userId: string, kind: KycDocumentKind, file: UploadedSelfie | undefined): Promise<KycDocumentDto> {
    assertKycAvailable(this.cipher);
    const account = await this.requireAccount(userId);
    if (kind === "SEPREC" && account.legalKind !== "COMPANY") throw fieldInvalid("SEPREC", "NOT_APPLICABLE");
    if (kind === "SELFIE") await this.consents.assertCurrentGranted(userId, "KYC_SELFIE");
    const measured = await measureKycDocument(file);
    const draft = await this.repository.runInTransaction((transaction) => this.lockDraft(account, transaction));
    const challenge = kind === "SELFIE" ? this.openChallenge(draft) : null;
    const encrypted = this.cipher.encrypt(measured.buffer);
    const stored = await this.storage.upload(
      { originalName: "kyc", mimeType: "application/octet-stream", sizeBytes: encrypted.byteLength, buffer: encrypted },
      { category: "kyc", accountId: account.userId, submissionId: draft.id, objectId: randomUUID() },
    );
    try {
      const documentId = await this.repository.runInTransaction(async (transaction) => {
        if (kind === "SELFIE") await this.consents.assertCurrentGranted(userId, "KYC_SELFIE", transaction);
        const locked = await this.lockDraft(account, transaction);
        if (locked.id !== draft.id) throw notEditable("WAIT");
        if (kind === "SELFIE" && this.openChallenge(locked) !== challenge) throw challengeRequired();
        await this.releaseDocuments(draft.id, { kinds: [kind] }, "REPLACED", transaction);
        const id = await this.repository.insertDocument(
          {
            submissionId: draft.id,
            kind,
            storageKey: stored.key,
            storageProvider: stored.provider,
            mime: measured.mime,
            sizeBytes: measured.buffer.byteLength,
            sha256: createHash("sha256").update(measured.buffer).digest("hex"),
            width: measured.width,
            height: measured.height,
            readable: measured.readable,
            readabilityCodes: measured.readabilityCodes,
            selfieChallengeCode: challenge,
          },
          transaction,
        );
        // A gesture is used once.
        if (kind === "SELFIE") await this.repository.updateSubmission(draft.id, { selfie_challenge_code: null, selfie_challenge_expires_at: null }, transaction);
        return id;
      });
      const row = await this.repository.findDocument(draft.id, documentId);
      if (!row) throw new NotFoundException("Documento no encontrado.");
      this.logger.log({ event: "kyc.document_uploaded", submissionId: draft.id, kind, readable: measured.readable });
      return mapDocument(row);
    } catch (error: unknown) {
      await this.discard(stored.key);
      throw error;
    }
  }

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const account = await this.requireAccount(userId);
    await this.repository.runInTransaction(async (transaction) => {
      const draft = await this.lockDraft(account, transaction);
      const released = await this.releaseDocuments(draft.id, { documentId }, "USER_REQUEST", transaction);
      if (released === 0) throw new NotFoundException("Documento no encontrado.");
    });
  }

  /** Clears the keys and queues the files on `media.release` in the same transaction. */
  async releaseDocuments(
    submissionId: string,
    where: { kinds?: readonly KycDocumentKind[]; documentId?: string },
    reason: "RETENTION" | "USER_REQUEST" | "CLOSURE" | "REPLACED",
    transaction: Transaction,
  ): Promise<number> {
    const rows = await this.repository.deleteDocuments({ submissionId, ...where }, reason, transaction);
    for (const row of rows) {
      await this.mediaRelease.requestRelease(
        { aggregateType: KYC_DOCUMENT_AGGREGATE, aggregateId: row.id, provider: row.storageProvider, storageKey: row.storageKey },
        transaction,
      );
    }
    return rows.length;
  }

  private openChallenge(draft: SubmissionRow): string {
    if (!draft.selfieChallengeCode || !draft.selfieChallengeExpiresAt) throw challengeRequired();
    if (draft.selfieChallengeExpiresAt <= this.clock()) {
      throw new DomainException(HttpStatus.GONE, "KYC_SELFIE_CHALLENGE_EXPIRED", "El gesto venció. Pide uno nuevo y toma la selfie.");
    }
    return draft.selfieChallengeCode;
  }

  private async discard(storageKey: string): Promise<void> {
    try {
      await this.storage.remove(storageKey);
    } catch (error: unknown) {
      this.logger.error({ event: "kyc.document_orphaned", storageKey, errorName: error instanceof Error ? error.name : "UnknownError" });
    }
  }
}

function challengeRequired(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, "KYC_SELFIE_CHALLENGE_REQUIRED", "Primero pide el gesto para tu selfie.");
}

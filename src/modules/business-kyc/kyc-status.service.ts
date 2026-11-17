import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { HandlesRepository } from "../business-accounts/handles.repository";
import { ConsentsService } from "../consents/consents.service";
import { BUSINESS_CONSENT_KINDS } from "../legal/consent-versions";
import { KycEffectsRepository } from "./kyc-effects.repository";
import { KYC_RULES } from "./kyc.catalog";
import { KYC_CLOCK, KycClock } from "./kyc-pipeline.service";
import { KycDecisionDto, KycSubmissionDto, mapDecisionForBusiness, mapSubmission } from "./kyc.mapper";
import { KycRepository, SubmissionRow } from "./kyc.repository";
import { missingForSubmit } from "./kyc-submit.service";
import { PhoneState, PhoneVerificationService } from "./phone/phone-verification.service";

export type KycStateDto = {
  /** KYC status of the account (the one that decides whether the listing is public). */
  kycStatus: string;
  accountStatus: string;
  /** «Verificado por REPP» only after a human approval; «Nuevo» for an automatic one. */
  badge: "VERIFIED" | "NEW" | null;
  /** The attempt being edited or waiting for REPP; otherwise the latest one. */
  submission: KycSubmissionDto | null;
  /** What still blocks the submit of a DRAFT (empty otherwise). */
  missing: string[];
  phone: PhoneState;
  consent: { kind: "KYC_SELFIE"; granted: boolean; upToDate: boolean; currentVersion: string };
  attempts: { used: number; max: number; resubmitAvailableAt: string | null; canResubmit: boolean };
  lastDecision: KycDecisionDto | null;
};

/** `GET /business/me/kyc`: where the wizard resumes, in one read. */
@Injectable()
export class KycStatusService {
  constructor(
    private readonly repository: KycRepository,
    private readonly effects: KycEffectsRepository,
    private readonly handles: HandlesRepository,
    private readonly phones: PhoneVerificationService,
    private readonly consents: ConsentsService,
    @Inject(KYC_CLOCK) private readonly clock: KycClock,
  ) {}

  async state(userId: string): Promise<KycStateDto> {
    const now = this.clock();
    const account = await this.effects.findAccount(userId);
    if (!account) throw new NotFoundException("Cuenta de negocio no encontrada.");
    const entity = await this.effects.findEntity(account.entityId);
    if (!entity) throw new NotFoundException("Negocio no encontrado.");
    const submission = (await this.repository.findOpen(userId)) ?? (await this.repository.findLatest(userId));
    const [documents, phone, consentList, used, handle] = await Promise.all([
      submission ? this.repository.listDocuments(submission.id) : Promise.resolve([]),
      this.phones.state(userId),
      this.consents.list(userId, BUSINESS_CONSENT_KINDS),
      this.repository.countSentAttempts(userId),
      this.handles.findCurrent(entity.id, now),
    ]);
    const lastDecision = submission ? await this.repository.latestHumanDecision(submission.id) : null;
    const consent = consentList.consents.find((entry) => entry.kind === "KYC_SELFIE");
    const missing =
      submission?.status === "DRAFT"
        ? missingForSubmit({ account, entity, submission, documents, hasHandle: Boolean(handle), hasPhone: Boolean(phone) })
        : [];
    return {
      kycStatus: account.kycStatus,
      accountStatus: account.status,
      badge: entity.status === "ACTIVE" ? (entity.isVerified ? "VERIFIED" : "NEW") : null,
      submission: submission ? mapSubmission(submission, documents, now) : null,
      missing,
      phone,
      consent: {
        kind: "KYC_SELFIE",
        granted: consent?.granted ?? false,
        upToDate: consent?.upToDate ?? false,
        currentVersion: consent?.currentVersion ?? "",
      },
      attempts: this.attempts(submission, used, now),
      lastDecision: mapDecisionForBusiness(lastDecision),
    };
  }

  private attempts(latest: SubmissionRow | null, used: number, now: Date): KycStateDto["attempts"] {
    const rejected = latest?.status === "REJECTED" && latest.purpose !== "MATERIAL_CHANGE" && latest.allowResubmit === true;
    const availableAt = rejected && latest.decidedAt ? new Date(latest.decidedAt.getTime() + KYC_RULES.resubmitCooldownMs) : null;
    const canResubmit = rejected && used < KYC_RULES.maxAttempts;
    return {
      used,
      max: KYC_RULES.maxAttempts,
      resubmitAvailableAt: canResubmit && availableAt ? availableAt.toISOString() : null,
      canResubmit: canResubmit && (!availableAt || availableAt <= now),
    };
  }
}

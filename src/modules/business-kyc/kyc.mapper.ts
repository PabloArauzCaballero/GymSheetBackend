import { describeGesture, VERIFICATION_GESTURES, VerificationGestureCode } from "../verification/verification.catalog";
import { KYC_REJECTION_REASONS, KycRejectionReason } from "./kyc.catalog";
import type { DecisionRow, DocumentRow, SubmissionRow } from "./kyc.repository";

export type KycDocumentDto = {
  id: string;
  kind: string;
  readable: boolean;
  readabilityCodes: string[];
  width: number | null;
  height: number | null;
  uploadedAt: string;
};

export type KycSubmissionDto = {
  id: string;
  version: number;
  purpose: string;
  status: string;
  legalKind: string;
  fields: {
    tradeName: string | null;
    primaryCategoryId: string | null;
    legalName: string | null;
    nitMasked: string | null;
    repFullName: string | null;
    repCiMasked: string | null;
    repCiComplement: string | null;
    repCiExtension: string | null;
    specialty: string | null;
    address: string | null;
    seprecNumber: string | null;
    phoneMasked: string | null;
  };
  documents: KycDocumentDto[];
  selfieChallenge: { code: string; instruction: string; expiresAt: string } | null;
  submittedAt: string | null;
  decidedAt: string | null;
  reviewDueAt: string | null;
  postReviewDueAt: string | null;
};

const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null);

export function mapDocument(row: DocumentRow): KycDocumentDto {
  return {
    id: row.id,
    kind: row.kind,
    readable: row.readable,
    readabilityCodes: row.readabilityCodes,
    width: row.width,
    height: row.height,
    uploadedAt: new Date(row.uploadedAt).toISOString(),
  };
}

function isGesture(code: string | null): code is VerificationGestureCode {
  return code !== null && code in VERIFICATION_GESTURES;
}

export function mapSubmission(row: SubmissionRow, documents: readonly DocumentRow[], now: Date): KycSubmissionDto {
  const challengeOpen = isGesture(row.selfieChallengeCode) && row.selfieChallengeExpiresAt && row.selfieChallengeExpiresAt > now;
  return {
    id: row.id,
    version: row.version,
    purpose: row.purpose,
    status: row.status,
    legalKind: row.legalKind,
    fields: {
      tradeName: row.tradeName,
      primaryCategoryId: row.primaryCategoryId,
      legalName: row.legalName,
      nitMasked: row.nitMasked,
      repFullName: row.repFullName,
      repCiMasked: row.repCiMasked,
      repCiComplement: row.repCiComplement,
      repCiExtension: row.repCiExtension,
      specialty: row.specialty,
      address: row.address,
      seprecNumber: row.seprecNumber,
      phoneMasked: row.phoneMasked,
    },
    documents: documents.map(mapDocument),
    selfieChallenge:
      challengeOpen && isGesture(row.selfieChallengeCode)
        ? { ...describeGesture(row.selfieChallengeCode), expiresAt: iso(row.selfieChallengeExpiresAt) ?? "" }
        : null,
    submittedAt: iso(row.submittedAt),
    decidedAt: iso(row.decidedAt),
    reviewDueAt: iso(row.reviewDueAt),
    postReviewDueAt: iso(row.postReviewDueAt),
  };
}

export type KycDecisionDto = {
  decision: string;
  reasonCodes: string[];
  reasons: string[];
  allowResubmit: boolean | null;
  decidedAt: string;
};

/** What the business reads about a human decision: codes and their texts, never the internal note or the moderator. */
export function mapDecisionForBusiness(row: DecisionRow | null): KycDecisionDto | null {
  if (!row) return null;
  return {
    decision: row.decision,
    reasonCodes: row.reasonCodes,
    reasons: row.reasonCodes.filter((code): code is KycRejectionReason => code in KYC_REJECTION_REASONS).map((code) => KYC_REJECTION_REASONS[code]),
    allowResubmit: row.allowResubmit,
    decidedAt: new Date(row.createdAt).toISOString(),
  };
}

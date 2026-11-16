import { resolveMediaUrl } from "../../common/media/media-url";
import { PhotoVerificationModel } from "./photo-verification.model";
import {
  describeGesture,
  VERIFICATION_REJECTION_REASONS,
  VerificationGesture,
  VerificationRejectionReason,
  VerificationStatusValue,
} from "./verification.catalog";
import { MemberPhoto } from "./verification.repository";

export type ChallengeResponse = { id: string; gesture: VerificationGesture; expiresAt: string };

export function mapChallenge(row: PhotoVerificationModel): ChallengeResponse {
  return {
    id: row.id,
    gesture: describeGesture(row.gestureCode),
    expiresAt: row.challengeExpiresAt.toISOString(),
  };
}

export type SubmissionResponse = { id: string; status: VerificationStatusValue; submittedAt: string | null };

export function mapSubmission(row: PhotoVerificationModel): SubmissionResponse {
  return { id: row.id, status: row.status, submittedAt: row.submittedAt?.toISOString() ?? null };
}

/** `NONE`: never tried. `REVOKED`: approved, then all compared photos were removed. */
export type MyVerificationStatus = VerificationStatusValue | "NONE" | "REVOKED";

export type DecisionResponse = {
  decision: "APPROVED" | "REJECTED";
  reason: VerificationRejectionReason | null;
  reasonText: string | null;
  decidedAt: string;
};

export type MyVerificationResponse = {
  status: MyVerificationStatus;
  verifiedAt: string | null;
  challenge: ChallengeResponse | null;
  lastDecision: DecisionResponse | null;
  canRetryAt: string | null;
};

export function mapDecision(row: PhotoVerificationModel | null): DecisionResponse | null {
  if (!row?.decidedAt || (row.status !== "APPROVED" && row.status !== "REJECTED")) return null;
  return {
    decision: row.status,
    reason: row.decisionReason,
    reasonText: row.decisionReason ? VERIFICATION_REJECTION_REASONS[row.decisionReason] : null,
    decidedAt: row.decidedAt.toISOString(),
  };
}

export type QueueItemResponse = {
  id: string;
  status: VerificationStatusValue;
  member: { id: string; name: string };
  /** Gym of the member: the platform queue mixes every gym (ADR-0018). */
  tenantId: string;
  tenantName: string | null;
  gesture: VerificationGesture;
  submittedAt: string | null;
  selfie: { url: string; expiresAt: string } | null;
  profilePhotos: { id: string; url: string }[];
};

export function mapQueueItem(
  row: PhotoVerificationModel,
  member: { name: string; tenantId: string; tenantName: string | null },
  photos: readonly MemberPhoto[],
  selfie: QueueItemResponse["selfie"],
): QueueItemResponse {
  return {
    id: row.id,
    status: row.status,
    member: { id: row.userId, name: member.name },
    tenantId: member.tenantId,
    tenantName: member.tenantName,
    gesture: describeGesture(row.gestureCode),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    selfie,
    profilePhotos: photos.map((photo) => ({ id: photo.id, url: resolveMediaUrl(photo.url) ?? photo.url })),
  };
}

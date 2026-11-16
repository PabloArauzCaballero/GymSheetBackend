import { HttpStatus } from "@nestjs/common";
import { DomainException } from "../../common/errors/domain.exception";
import { KycStatus } from "./kyc.catalog";

/**
 * Allowed transitions of one KYC attempt (plan §2.5). REJECTED is terminal
 * for the attempt: a resubmission or a material change is a NEW version that
 * starts in DRAFT. SUPERSEDED (terminal) is an approved version that an
 * approved material change replaced.
 */
export const KYC_TRANSITIONS: Readonly<Record<KycStatus, readonly KycStatus[]>> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["AUTO_APPROVED", "IN_REVIEW"],
  AUTO_APPROVED: ["APPROVED", "SUSPENDED", "REJECTED", "SUPERSEDED"],
  IN_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED", "SUPERSEDED"],
  SUSPENDED: ["APPROVED", "REJECTED"],
  REJECTED: [],
  SUPERSEDED: [],
};

export function canTransition(from: KycStatus, to: KycStatus): boolean {
  return KYC_TRANSITIONS[from].includes(to);
}

/** 409 KYC_INVALID_TRANSITION for any move outside the table. */
export function assertKycTransition(from: KycStatus, to: KycStatus): void {
  if (canTransition(from, to)) return;
  throw new DomainException(
    HttpStatus.CONFLICT,
    "KYC_INVALID_TRANSITION",
    "La solicitud de verificación no admite ese cambio en su estado actual.",
    { from, to },
  );
}

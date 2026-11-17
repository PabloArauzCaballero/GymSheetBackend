import { env } from "../../config/env";
import { LegalKind } from "../business-accounts/business-accounts.schemas";

/** Status of one KYC attempt (`business.kyc_submissions.status`), plan §2.5. */
export const KYC_STATUSES = ["DRAFT", "SUBMITTED", "AUTO_APPROVED", "IN_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "SUPERSEDED"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export type KycPurpose = "INITIAL" | "RESUBMISSION" | "MATERIAL_CHANGE";

export const KYC_DOCUMENT_KINDS = ["CI_FRONT", "CI_BACK", "SELFIE", "SEPREC"] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

/**
 * Documents a submission needs, by legal kind. The logo of a company is the
 * listing's public logo (`POST /business/me/media`, slot LOGO): it is public by
 * purpose, so it is not stored a second time as a private document.
 */
export const REQUIRED_DOCUMENTS: Record<LegalKind, readonly KycDocumentKind[]> = {
  COMPANY: ["CI_FRONT", "CI_BACK", "SELFIE"],
  INDIVIDUAL: ["CI_FRONT", "CI_BACK", "SELFIE"],
};

export type KycCheckCode =
  | "PHONE_VERIFIED"
  | "DOCUMENTS_READABLE"
  | "DUPLICATE_NIT"
  | "DUPLICATE_CI"
  | "DUPLICATE_PHONE"
  | "DUPLICATE_EMAIL"
  | "NAME_SIMILARITY"
  | "ANTIBOT_RISK"
  | "BLOCKLIST"
  | "CLOSED_ACCOUNT_SANCTION"
  | "BANNED_TERMS"
  | "MATERIAL_CHANGE"
  | "IMAGE_MODERATION";
export type KycCheckOutcome = "PASS" | "FAIL" | "WARN" | "ERROR";

/**
 * What the business may read about a check that did not pass. BLOCKLIST and
 * CLOSED_ACCOUNT_SANCTION are never shown: telling which datum is blocked
 * would make the submission an oracle for the blocklist.
 */
export const USER_FACING_CHECKS: ReadonlySet<KycCheckCode> = new Set([
  "PHONE_VERIFIED",
  "DOCUMENTS_READABLE",
  "DUPLICATE_NIT",
  "DUPLICATE_PHONE",
  "NAME_SIMILARITY",
  "MATERIAL_CHANGE",
]);

/** Rejection reasons REPP picks from, with the text the business reads. */
export const KYC_REJECTION_REASONS = {
  DOCUMENT_UNREADABLE: "Uno de los documentos no se lee bien.",
  DOCUMENT_MISMATCH: "Los datos de los documentos no coinciden con los que escribiste.",
  SELFIE_MISMATCH: "La selfie no coincide con la foto del carnet.",
  GESTURE_MISMATCH: "El gesto de la selfie no es el que te pedimos.",
  NIT_INVALID: "No pudimos confirmar el NIT.",
  LEGAL_NAME_MISMATCH: "La razón social no coincide con el NIT.",
  IMPERSONATION: "El nombre o la imagen se hacen pasar por otro negocio.",
  DUPLICATE_ACCOUNT: "Ya existe otra cuenta de negocio con estos datos.",
  PROHIBITED_ACTIVITY: "La actividad del negocio no está permitida en REPP.",
  FRAUD_SUSPECTED: "Encontramos señales de fraude en la solicitud.",
  OTHER: "No pudimos verificar tu negocio con esta solicitud.",
} as const;
export type KycRejectionReason = keyof typeof KYC_REJECTION_REASONS;
export const KYC_REJECTION_REASON_CODES = Object.keys(KYC_REJECTION_REASONS) as [KycRejectionReason, ...KycRejectionReason[]];

/** Why REPP suspends a business account. */
export const BUSINESS_SUSPENSION_REASONS = {
  FRAUD_SUSPECTED: "Encontramos señales de fraude.",
  IMPERSONATION: "El negocio se hace pasar por otro.",
  PAYMENT_COMPLAINTS: "Recibimos denuncias por cobros no entregados.",
  PROHIBITED_ACTIVITY: "La actividad del negocio no está permitida en REPP.",
  KYC_MISSING: "Faltan los datos de verificación del negocio.",
  OTHER: "El negocio no cumple las normas de REPP.",
} as const;
export type BusinessSuspensionReason = keyof typeof BUSINESS_SUSPENSION_REASONS;
export const BUSINESS_SUSPENSION_REASON_CODES = Object.keys(BUSINESS_SUSPENSION_REASONS) as [
  BusinessSuspensionReason,
  ...BusinessSuspensionReason[],
];

export const KYC_RULES = {
  /** Initial attempt plus resubmissions. */
  maxAttempts: 3,
  resubmitCooldownMs: 24 * 60 * 60 * 1000,
  selfieChallengeTtlMs: 15 * 60 * 1000,
  /** A claim nobody touched for this long can be taken by another moderator. */
  claimTtlMs: 30 * 60 * 1000,
  documentMaxBytes: 8 * 1024 * 1024,
  queuePageMax: 100,
} as const;

/**
 * Retention of KYC data (plan §2.14), read from the environment
 * (`KYC_RETENTION_*_DAYS`, ADR-0028): proposed values PENDING the lawyer's
 * review (Q5), so changing one is a deploy setting, not a code change.
 */
export function kycRetention() {
  return {
    /** A DRAFT nobody touched for this long loses its documents. */
    ABANDONED_DRAFT_DAYS: env.KYC_RETENTION_ABANDONED_DRAFT_DAYS,
    /** Documents and encrypted data of a rejected attempt. */
    REJECTED_DAYS: env.KYC_RETENTION_REJECTED_DAYS,
    /** The selfie of a decided attempt (as the person verification). */
    SELFIE_AFTER_DECISION_DAYS: env.KYC_RETENTION_SELFIE_DAYS,
    /** Documents of an approved attempt that a newer approved version replaced. */
    SUPERSEDED_DAYS: env.KYC_RETENTION_SUPERSEDED_DAYS,
    /** Documents and identity data of a closed business: fraud investigation window. */
    CLOSED_ACCOUNT_DAYS: env.KYC_RETENTION_CLOSED_ACCOUNT_DAYS,
    /** Unverified phone codes. */
    PHONE_CODE_DAYS: env.KYC_RETENTION_PHONE_CODE_DAYS,
    /** Decisions, checks, history and fingerprints of a closed business (no image, no datum in clear). */
    RECORDS_DAYS: env.KYC_RETENTION_RECORDS_DAYS,
  };
}

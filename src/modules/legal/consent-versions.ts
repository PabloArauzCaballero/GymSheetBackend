/**
 * Separate, revocable consents for sensitive data (ADR-0014). Each one is
 * recorded in `auth.consents` with the version of the text the person saw.
 */
export const CONSENT_KINDS = ["HEALTH", "ORIENTATION", "VERIFICATION_SELFIE", "PRECISE_LOCATION", "KYC_SELFIE"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Consents a person gives (`me/consents`); a business gives only the KYC selfie one (ADR-0021). */
export const PERSON_CONSENT_KINDS = ["HEALTH", "ORIENTATION", "VERIFICATION_SELFIE", "PRECISE_LOCATION"] as const;
export const BUSINESS_CONSENT_KINDS = ["KYC_SELFIE"] as const;

export function consentKindsFor(accountKind: "PERSON" | "BUSINESS"): readonly ConsentKind[] {
  return accountKind === "BUSINESS" ? BUSINESS_CONSENT_KINDS : PERSON_CONSENT_KINDS;
}

/**
 * Current version of each consent text. Bump it when the text changes; a
 * consent given to an older version stays valid but is reported with
 * `upToDate: false` so the client can ask again. Read at call time.
 */
export const CONSENT_VERSIONS: Record<ConsentKind, string> = {
  // 2026-12-02: the four checkbox texts were rewritten (third legal review, N2).
  // Grants recorded with 2026-12-01 accepted the previous texts.
  HEALTH: "2026-12-02",
  ORIENTATION: "2026-12-02",
  VERIFICATION_SELFIE: "2026-12-02",
  PRECISE_LOCATION: "2026-12-02",
  // Selfie of the representative of a business for its KYC (ADR-0021). Draft text, pending the lawyer.
  KYC_SELFIE: "2026-11-16",
};

export function currentConsentVersions(accountKind: "PERSON" | "BUSINESS" = "PERSON"): { kind: ConsentKind; version: string }[] {
  return consentKindsFor(accountKind).map((kind) => ({ kind, version: CONSENT_VERSIONS[kind] }));
}

/**
 * Separate, revocable consents for sensitive data (ADR-0014). Each one is
 * recorded in `auth.consents` with the version of the text the person saw.
 */
export const CONSENT_KINDS = ["HEALTH", "ORIENTATION", "VERIFICATION_SELFIE", "PRECISE_LOCATION"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/**
 * Current version of each consent text. Bump it when the text changes; a
 * consent given to an older version stays valid but is reported with
 * `upToDate: false` so the client can ask again. Read at call time.
 */
export const CONSENT_VERSIONS: Record<ConsentKind, string> = {
  HEALTH: "2026-12-01",
  ORIENTATION: "2026-12-01",
  VERIFICATION_SELFIE: "2026-12-01",
  PRECISE_LOCATION: "2026-12-01",
};

export function currentConsentVersions(): { kind: ConsentKind; version: string }[] {
  return CONSENT_KINDS.map((kind) => ({ kind, version: CONSENT_VERSIONS[kind] }));
}

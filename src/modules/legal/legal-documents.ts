/**
 * Legal documents a person must accept to use the app. COMMUNITY is the
 * community rules: the terms incorporate them, so a change to the rules needs
 * a new acceptance like any other document.
 */
export const LEGAL_DOCUMENT_TYPES = ["TERMS", "PRIVACY", "COMMUNITY"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENT_TYPES)[number];

export type LegalDocumentVersion = { document: LegalDocument; version: string };

/** A published document: its version plus the SHA-256 of the exact text shown. */
export type PublishedLegalDocument = LegalDocumentVersion & { contentSha256: string | null };

/**
 * Current version of each legal document.
 *
 * Bump a version when its text changes: every account that has not accepted
 * the new version gets `428 LEGAL_ACCEPTANCE_REQUIRED` until it does. Read the
 * values at call time (never copy them into module-level constants) so a
 * single edit here is the only change needed.
 */
export const LEGAL_DOCUMENTS: Record<LegalDocument, string> = {
  TERMS: "2026-08-25",
  PRIVACY: "2026-08-25",
  COMMUNITY: "2026-08-25",
};

/**
 * SHA-256 (lowercase hex) of the exact published text of the CURRENT version,
 * stored with every acceptance as proof of what was accepted. Set it in the
 * same change that bumps the version: `yarn legal:hash <file>` prints it.
 * The 2026-08-25 texts were published before hashing existed and are not in
 * this repository, so their hash is unknown (null) rather than invented.
 */
export const LEGAL_DOCUMENT_CONTENT_SHA256: Record<LegalDocument, string | null> = {
  TERMS: null,
  PRIVACY: null,
  COMMUNITY: null,
};

/** Kept for compatibility with code that predates the catalog. */
export const CURRENT_TERMS_VERSION = LEGAL_DOCUMENTS.TERMS;

export function currentLegalDocuments(): PublishedLegalDocument[] {
  return LEGAL_DOCUMENT_TYPES.map((document) => ({
    document,
    version: LEGAL_DOCUMENTS[document],
    contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256[document],
  }));
}

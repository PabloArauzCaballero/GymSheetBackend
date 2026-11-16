/** Legal documents a person must accept to use the app. */
export const LEGAL_DOCUMENT_TYPES = ["TERMS", "PRIVACY"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENT_TYPES)[number];

export type LegalDocumentVersion = { document: LegalDocument; version: string };

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
};

/** Kept for compatibility with code that predates the catalog. */
export const CURRENT_TERMS_VERSION = LEGAL_DOCUMENTS.TERMS;

export function currentLegalDocuments(): LegalDocumentVersion[] {
  return LEGAL_DOCUMENT_TYPES.map((document) => ({ document, version: LEGAL_DOCUMENTS[document] }));
}

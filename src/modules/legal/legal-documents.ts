import type { AccountKind } from "../../common/types/auth-context.types";

/**
 * Legal documents an account must accept. COMMUNITY is the community rules:
 * the terms incorporate them, so a change to the rules needs a new acceptance
 * like any other document. BUSINESS_TERMS and BUSINESS_DPA are the terms for
 * businesses and the data processing agreement (ADR-0020).
 */
export const LEGAL_DOCUMENT_TYPES = ["TERMS", "PRIVACY", "COMMUNITY", "BUSINESS_TERMS", "BUSINESS_DPA"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENT_TYPES)[number];

/**
 * Which documents each kind of account must accept. Whether the privacy policy
 * also covers a business's representatives is the lawyer's call; until then it
 * is in both sets.
 */
export const LEGAL_DOCUMENT_SETS: Record<AccountKind, readonly LegalDocument[]> = {
  PERSON: ["TERMS", "PRIVACY", "COMMUNITY"],
  BUSINESS: ["BUSINESS_TERMS", "BUSINESS_DPA", "PRIVACY"],
};

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
  BUSINESS_TERMS: "2026-11-16",
  BUSINESS_DPA: "2026-11-16",
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
  BUSINESS_TERMS: "2a94f4336b794a52ce8b3b172b01d03956dc3ad03c757905f79a9aca597e28c0",
  BUSINESS_DPA: "1a302c5f75e9976d642f725f4ff94e8e70f57b1859a42ec4c2d844c284b01095",
};

/**
 * Repository file of the current text, for the documents whose text lives
 * here. `legal-documents.spec.ts` recomputes each hash from its file, so the
 * catalog cannot drift from the text.
 */
export const LEGAL_DOCUMENT_SOURCES: Partial<Record<LegalDocument, string>> = {
  BUSINESS_TERMS: "docs/legal/negocios/terminos-para-negocios-2026-11-16.md",
  BUSINESS_DPA: "docs/legal/negocios/acuerdo-de-tratamiento-de-datos-2026-11-16.md",
};

/**
 * The business texts in the repository are placeholders until the lawyer
 * signs them (ADR-0020). While this is true a production deploy keeps the
 * business signup closed even if `BUSINESS_SIGNUP_ENABLED` is on.
 */
export const BUSINESS_LEGAL_TEXTS_ARE_DRAFTS = true;

/** Kept for compatibility with code that predates the catalog. */
export const CURRENT_TERMS_VERSION = LEGAL_DOCUMENTS.TERMS;

export function currentLegalDocuments(kind: AccountKind = "PERSON"): PublishedLegalDocument[] {
  return LEGAL_DOCUMENT_SETS[kind].map((document) => ({
    document,
    version: LEGAL_DOCUMENTS[document],
    contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256[document],
  }));
}

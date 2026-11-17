import type { Transaction } from "sequelize";
import type { DirectoryEntityType } from "../directory/directory-entity.model";
import { FingerprintKind } from "./kyc-cipher";
import { KycCheckCode, KycCheckOutcome, KycDocumentKind, KycPurpose, REQUIRED_DOCUMENTS } from "./kyc.catalog";
import type { LegalKind } from "../business-accounts/business-accounts.schemas";

/** Everything the automatic checks look at. No datum in clear: identities travel as HMACs. */
export type KycCheckContext = {
  submissionId: string;
  accountId: string;
  entityId: string;
  entityType: DirectoryEntityType;
  legalKind: LegalKind;
  purpose: KycPurpose;
  tradeName: string;
  handle: string;
  description: string;
  signupRisk: "LOW" | "MEDIUM" | "HIGH" | null;
  phoneVerified: boolean;
  documents: readonly { kind: KycDocumentKind; readable: boolean }[];
  fingerprints: Partial<Record<FingerprintKind, string>>;
};

/** Read-only probes the checks run; every one is an indexed query bounded by the statement timeout. */
export interface KycCheckQueries {
  /** Other non-closed business accounts holding this live fingerprint. */
  countOtherAccountsWith(kind: FingerprintKind, hmac: string, exceptAccountId: string, transaction: Transaction): Promise<number>;
  /** A public listing of the same type whose normalized name is ≥ 0.8 similar, or a REPP-reserved skeleton. */
  nameLooksTaken(name: string, entityType: DirectoryEntityType, exceptEntityId: string, transaction: Transaction): Promise<boolean>;
  isBlocked(fingerprints: readonly { kind: FingerprintKind; hmac: string }[], transaction: Transaction): Promise<boolean>;
  /** A closed account's sanction under this email, or a closed business's under this NIT or CI (ADR-0028). */
  hasClosedAccountSanction(trace: { email?: string; nit?: string; ci?: string }, transaction: Transaction): Promise<boolean>;
  containsBannedTerm(texts: readonly string[], transaction: Transaction): Promise<boolean>;
}

export type KycCheckResult = { outcome: KycCheckOutcome; detail?: Record<string, unknown> };

export type KycCheck = {
  code: KycCheckCode;
  run(context: KycCheckContext, queries: KycCheckQueries, transaction: Transaction): Promise<KycCheckResult>;
};

const PASS: KycCheckResult = { outcome: "PASS" };

function duplicateCheck(code: KycCheckCode, kind: FingerprintKind, onMatch: KycCheckOutcome): KycCheck {
  return {
    code,
    async run(context, queries, transaction) {
      const hmac = context.fingerprints[kind];
      if (!hmac) return { outcome: "PASS", detail: { applicable: false } };
      const matches = await queries.countOtherAccountsWith(kind, hmac, context.accountId, transaction);
      return matches === 0 ? PASS : { outcome: onMatch, detail: { matches } };
    },
  };
}

/**
 * The automatic checks of plan §2.6, in order. Their `detail` holds codes and
 * counts only, never personal data. A check that does not pass sends the
 * submission to REPP review; none of them rejects (fail towards review).
 * Formats, presence of fields and documents and the verified email are
 * preconditions of the submit (422), not checks.
 */
export const KYC_CHECKS: readonly KycCheck[] = [
  {
    code: "PHONE_VERIFIED",
    run: (context) => Promise.resolve(context.phoneVerified ? PASS : { outcome: "FAIL", detail: { reason: "NOT_VERIFIED" } }),
  },
  {
    code: "DOCUMENTS_READABLE",
    run(context) {
      const required = new Set<KycDocumentKind>(REQUIRED_DOCUMENTS[context.legalKind]);
      const unreadable = context.documents.filter((doc) => required.has(doc.kind) && !doc.readable).map((doc) => doc.kind);
      return Promise.resolve(unreadable.length === 0 ? PASS : { outcome: "FAIL", detail: { kinds: unreadable } });
    },
  },
  duplicateCheck("DUPLICATE_NIT", "NIT", "FAIL"),
  // The same representative may own a gym and a shop: a warning for REPP, still a review.
  duplicateCheck("DUPLICATE_CI", "CI", "WARN"),
  duplicateCheck("DUPLICATE_PHONE", "PHONE", "FAIL"),
  duplicateCheck("DUPLICATE_EMAIL", "EMAIL", "FAIL"),
  {
    code: "NAME_SIMILARITY",
    async run(context, queries, transaction) {
      const taken = await queries.nameLooksTaken(context.tradeName, context.entityType, context.entityId, transaction);
      return taken ? { outcome: "FAIL" } : PASS;
    },
  },
  {
    code: "ANTIBOT_RISK",
    run: (context) =>
      Promise.resolve(context.signupRisk === "LOW" ? PASS : { outcome: "FAIL", detail: { risk: context.signupRisk ?? "UNKNOWN" } }),
  },
  {
    code: "BLOCKLIST",
    async run(context, queries, transaction) {
      const fingerprints = Object.entries(context.fingerprints).flatMap(([kind, hmac]) =>
        hmac ? [{ kind: kind as FingerprintKind, hmac }] : [],
      );
      return (await queries.isBlocked(fingerprints, transaction)) ? { outcome: "FAIL" } : PASS;
    },
  },
  {
    code: "CLOSED_ACCOUNT_SANCTION",
    async run(context, queries, transaction) {
      const { EMAIL: email, NIT: nit, CI: ci } = context.fingerprints;
      if (!email && !nit && !ci) return PASS;
      return (await queries.hasClosedAccountSanction({ email, nit, ci }, transaction)) ? { outcome: "FAIL" } : PASS;
    },
  },
  {
    code: "BANNED_TERMS",
    async run(context, queries, transaction) {
      const hit = await queries.containsBannedTerm([context.tradeName, context.handle, context.description], transaction);
      return hit ? { outcome: "FAIL" } : PASS;
    },
  },
];

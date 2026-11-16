import { z } from "zod";
import { businessNameSkeleton } from "../business-accounts/handle-rules";
import { entityTypeEnum } from "../directory/directory.schemas";
import { BUSINESS_SUSPENSION_REASON_CODES, KYC_DOCUMENT_KINDS, KYC_REJECTION_REASON_CODES, KYC_RULES } from "./kyc.catalog";
import { CI_EXTENSIONS } from "./kyc-formats";

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

/**
 * One wizard step saved on the server (`PUT /business/me/kyc/draft`). Every
 * field is optional (partial save); `null` clears it. Unknown keys are refused.
 * `tradeName` and `primaryCategoryId` are accepted only in a material change:
 * during the first verification they come from the listing itself.
 */
export const kycDraftSchema = z
  .object({
    legalName: nullableText(200),
    nit: nullableText(32),
    repFullName: nullableText(180),
    repCiNumber: nullableText(20),
    repCiComplement: z.string().trim().max(2).nullable(),
    repCiExtension: z.enum(CI_EXTENSIONS).nullable(),
    specialty: nullableText(120),
    address: nullableText(500),
    seprecNumber: nullableText(40),
    tradeName: z
      .string()
      .max(720)
      .transform((name) => name.normalize("NFKC").trim())
      .pipe(z.string().min(2).max(180)),
    primaryCategoryId: z.string().uuid(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Envía al menos un campo." });
export type KycDraftInput = z.infer<typeof kycDraftSchema>;

export const kycDocumentBodySchema = z.object({ kind: z.enum(KYC_DOCUMENT_KINDS) }).strict();

export const phoneRequestSchema = z.object({ phone: text(24) }).strict();
export const phoneConfirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/u, "El código tiene 6 dígitos.") }).strict();

export const kycConsentSchema = z
  .object({ granted: z.boolean(), version: z.string().trim().min(1).max(20).optional() })
  .strict()
  .refine((input) => !input.granted || input.version !== undefined, { message: "Indica la versión del texto que aceptaste.", path: ["version"] });

export const kycDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "POST_REVIEW_OK", "REJECT"]),
    reasonCodes: z.array(z.enum(KYC_REJECTION_REASON_CODES)).max(6).default([]),
    note: z.string().trim().max(1000).optional(),
    allowResubmit: z.boolean().optional(),
  })
  .strict()
  .refine((input) => input.decision !== "REJECT" || input.reasonCodes.length > 0, {
    message: "Un rechazo lleva al menos un motivo.",
    path: ["reasonCodes"],
  })
  .refine((input) => input.decision !== "REJECT" || input.allowResubmit !== undefined, {
    message: "Indica si el negocio puede volver a enviar la solicitud.",
    path: ["allowResubmit"],
  });
export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;

export const kycQueueQuerySchema = z
  .object({
    queue: z.enum(["REVIEW", "POST_REVIEW"]),
    entityType: entityTypeEnum.optional(),
    overdue: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    cursor: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(KYC_RULES.queuePageMax).default(25),
  })
  .strict();
export type KycQueueQuery = z.infer<typeof kycQueueQuerySchema>;

export const accountActionSchema = z
  .object({ reasonCode: z.enum(BUSINESS_SUSPENSION_REASON_CODES), note: z.string().trim().max(1000).optional() })
  .strict();
export type AccountActionInput = z.infer<typeof accountActionSchema>;

export const accountsQuerySchema = z
  .object({
    search: z.string().trim().min(2).max(100).optional(),
    status: z.enum(["ONBOARDING", "ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
    entityType: entityTypeEnum.optional(),
    cursor: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AccountsQuery = z.infer<typeof accountsQuerySchema>;

export const handleReservationSchema = z.object({ handle: text(64), reason: text(200) }).strict();
export const forceRenameSchema = z.object({ newHandle: text(64), reason: text(200) }).strict();

export const blocklistEntrySchema = z
  .object({
    kind: z.enum(["NIT", "CI", "PHONE", "EMAIL"]),
    value: text(254),
    reasonCode: z.string().trim().regex(/^[A-Z0-9_]{2,40}$/u),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export type BlocklistEntryInput = z.infer<typeof blocklistEntrySchema>;

export const bannedTermsSchema = z
  .object({
    terms: z
      .array(
        z
          .object({
            term: z
              .string()
              .trim()
              .min(2)
              .max(80)
              .transform((term) => term.normalize("NFKC").toLowerCase())
              .refine((term) => businessNameSkeleton(term).length >= 2, "El término necesita al menos dos letras o números."),
            scope: z.enum(["NAME", "LISTING", "BOTH"]),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type BannedTermsInput = z.infer<typeof bannedTermsSchema>;

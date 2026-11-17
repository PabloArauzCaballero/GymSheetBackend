import { z } from "zod";
import { VERIFICATION_REJECTION_REASON_CODES, VerificationStatus } from "./verification.catalog";

export const verificationQueueQuerySchema = z
  .object({
    status: z.nativeEnum(VerificationStatus).default(VerificationStatus.PENDING_REVIEW),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type VerificationQueueQuery = z.infer<typeof verificationQueueQuerySchema>;

/** A rejection always names a reason from the closed list; an approval never carries one. */
export const decideVerificationSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.enum(VERIFICATION_REJECTION_REASON_CODES).optional(),
    /**
     * The profile photo ids the moderator compared (from the queue item). An
     * approval is bound to exactly that set: if the gallery changed meanwhile,
     * the moderator never saw the photos the badge would vouch for.
     */
    comparedPhotoIds: z.array(z.string().uuid()).min(1).max(12).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.decision === "REJECT" && !input.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Indica el motivo del rechazo." });
    }
    if (input.decision === "APPROVE" && !input.comparedPhotoIds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comparedPhotoIds"],
        message: "Indica las fotos que comparaste.",
      });
    }
    if (input.decision === "APPROVE" && input.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Una aprobación no lleva motivo." });
    }
  });
export type DecideVerificationInput = z.infer<typeof decideVerificationSchema>;

export const selfieLinkQuerySchema = z
  .object({
    expires: z.coerce.number().int().positive(),
    signature: z.string().regex(/^[\w-]{20,100}$/u),
  })
  .strict();
export type SelfieLinkQuery = z.infer<typeof selfieLinkQuerySchema>;

import { z } from "zod";
import { PERSON_CONSENT_KINDS } from "../legal/consent-versions";

/** `me/consents` is a person surface; the business KYC selfie consent has its own route (ADR-0021). */
export const consentKindSchema = z.enum(PERSON_CONSENT_KINDS);

/** Granting names the text version shown; revoking needs no version. */
export const setConsentSchema = z
  .object({
    granted: z.boolean(),
    version: z.string().trim().min(1).max(20).optional(),
  })
  .refine((input) => !input.granted || input.version !== undefined, {
    message: "Indica la versión del texto que aceptaste.",
    path: ["version"],
  });

export type SetConsentInput = z.infer<typeof setConsentSchema>;

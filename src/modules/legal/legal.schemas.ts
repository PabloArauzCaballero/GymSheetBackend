import { z } from "zod";
import { LEGAL_DOCUMENT_TYPES } from "./legal-documents";

const documentVersionShape = {
  document: z.enum(LEGAL_DOCUMENT_TYPES),
  version: z.string().trim().min(1).max(20),
};

export const acceptLegalDocumentsSchema = z.object({
  acceptances: z.array(z.object(documentVersionShape)).min(1).max(LEGAL_DOCUMENT_TYPES.length),
});

/** One document a signup shows: its version and, optionally, the hash the client got from `/legal/current`. */
export const signupAcceptanceSchema = z.object({
  ...documentVersionShape,
  contentSha256: z.string().trim().regex(/^[0-9a-f]{64}$/u).optional(),
});

/** `GET /legal/current?accountKind=BUSINESS` returns the business set; default is the person set. */
export const currentLegalQuerySchema = z.object({
  accountKind: z.enum(["PERSON", "BUSINESS"]).default("PERSON"),
});

export type AcceptLegalDocumentsInput = z.infer<typeof acceptLegalDocumentsSchema>;
export type SignupAcceptance = z.infer<typeof signupAcceptanceSchema>;
export type CurrentLegalQuery = z.infer<typeof currentLegalQuerySchema>;

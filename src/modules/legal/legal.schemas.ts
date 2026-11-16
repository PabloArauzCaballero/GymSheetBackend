import { z } from "zod";
import { LEGAL_DOCUMENT_TYPES } from "./legal-documents";

export const acceptLegalDocumentsSchema = z.object({
  acceptances: z
    .array(
      z.object({
        document: z.enum(LEGAL_DOCUMENT_TYPES),
        version: z.string().trim().min(1).max(20),
      }),
    )
    .min(1)
    .max(LEGAL_DOCUMENT_TYPES.length),
});

export type AcceptLegalDocumentsInput = z.infer<typeof acceptLegalDocumentsSchema>;

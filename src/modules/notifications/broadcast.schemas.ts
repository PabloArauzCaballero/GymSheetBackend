import { z } from "zod";

/** Segmentos de audiencia para una campaña de publicidad in-app. */
export const broadcastSegmentSchema = z.enum([
  "ALL_ACTIVE",
  "ACTIVE_CLIENTS",
  "ACTIVE_MEMBERS",
]);

export type BroadcastSegment = z.infer<typeof broadcastSegmentSchema>;

/** Campaña de mensajería de publicidad dentro de la app (canal in-app). */
export const broadcastSchema = z
  .object({
    subject: z.string().trim().min(3).max(240),
    body: z.string().trim().min(3).max(4000),
    segment: broadcastSegmentSchema.default("ALL_ACTIVE"),
    /** Límite de seguridad de destinatarios por campaña. */
    maxRecipients: z.coerce.number().int().min(1).max(20000).default(20000),
  })
  .strict();

export type BroadcastInput = z.infer<typeof broadcastSchema>;

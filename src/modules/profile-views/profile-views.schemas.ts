import { z } from "zod";

export const recordProfileViewSchema = z.object({
  viewedUserId: z.string().uuid(),
});
export type RecordProfileViewInput = z.infer<typeof recordProfileViewSchema>;

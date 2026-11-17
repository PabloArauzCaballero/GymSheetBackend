import { z } from "zod";

export const membershipVisibilitySchema = z.object({ membershipVisible: z.boolean() }).strict();

export type MembershipVisibilityInput = z.infer<typeof membershipVisibilitySchema>;

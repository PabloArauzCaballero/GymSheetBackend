import { z } from "zod";
import { fullNameSchema, normalizedEmailSchema } from "../auth/auth.schemas";

const pinSchema = z.string().trim().regex(/^\d{6}$/u, "El código son seis dígitos.");
/** Same bounds as signup and login: a longer string is never a real password. */
const currentPasswordSchema = z.string().min(1).max(128);

/**
 * Proof for closing the account: the current password, or an email PIN for
 * accounts created with Google or Apple. Exactly one of the two.
 */
export const closeAccountSchema = z
  .object({ password: currentPasswordSchema.optional(), pin: pinSchema.optional() })
  .strict()
  .refine((input) => (input.password === undefined) !== (input.pin === undefined), {
    message: "Confirma con tu contraseña o con el código que te enviamos.",
  });

/** Name rectification: same rule as signup. */
export const updateAccountSchema = z.object({ nombreCompleto: fullNameSchema }).strict();

export const emailChangeRequestSchema = z
  .object({ newEmail: normalizedEmailSchema, password: currentPasswordSchema })
  .strict();

export const emailChangeConfirmSchema = z.object({ pin: pinSchema }).strict();

export type CloseAccountInput = z.infer<typeof closeAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type EmailChangeRequestInput = z.infer<typeof emailChangeRequestSchema>;
export type EmailChangeConfirmInput = z.infer<typeof emailChangeConfirmSchema>;

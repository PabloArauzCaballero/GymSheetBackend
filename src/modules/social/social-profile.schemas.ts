import { z } from "zod";
import {
  DRINKING_CODES,
  INTEREST_CODES,
  MAX_PROFILE_BIO_LENGTH,
  MAX_PROFILE_INTERESTS,
  ORIENTATION_CODES,
  PETS_CODES,
  SMOKING_CODES,
} from "./social-profile.catalog";

// Contact details in a bio move conversations off-platform, where moderation
// and blocking no longer protect anyone.
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)|\b[\p{L}\p{N}-]+\.(?:com|net|org|info|io|me|app|co|ly|gg|link|bio|site|online|xyz|es|mx|ar|cl|pe|bo|uy|py|ec|ve|us|tv)\b/iu;
const PHONE_PATTERN = /\+?\d(?:[\s().-]*\d){6,}/u;

export function bioContainsUrl(bio: string): boolean {
  return URL_PATTERN.test(bio);
}

export function bioContainsPhone(bio: string): boolean {
  return PHONE_PATTERN.test(bio);
}

const bioSchema = z
  .string()
  .trim()
  .max(MAX_PROFILE_BIO_LENGTH, {
    message: `Tu bio puede tener hasta ${MAX_PROFILE_BIO_LENGTH} caracteres.`,
  })
  .refine((bio) => !bioContainsUrl(bio), {
    message: "Tu bio no puede incluir enlaces ni direcciones web.",
  })
  .refine((bio) => !bioContainsPhone(bio), {
    message: "Tu bio no puede incluir números de teléfono.",
  })
  .transform((bio) => (bio.length ? bio : null));

/**
 * PUT semantics: the body is the whole profile. An omitted optional answer is
 * stored as "not answered" (null / empty list).
 */
export const updateSocialProfileSchema = z
  .object({
    orientation: z.enum(ORIENTATION_CODES).nullable().default(null),
    orientationVisible: z.boolean().default(false),
    interests: z
      .array(z.enum(INTEREST_CODES))
      .max(MAX_PROFILE_INTERESTS, {
        message: `Elige hasta ${MAX_PROFILE_INTERESTS} intereses.`,
      })
      .default([]),
    drinking: z.enum(DRINKING_CODES).nullable().default(null),
    smoking: z.enum(SMOKING_CODES).nullable().default(null),
    pets: z.enum(PETS_CODES).nullable().default(null),
    bio: bioSchema.nullable().default(null),
    expectedVersion: z.number().int().nonnegative(),
  })
  .superRefine((profile, context) => {
    if (new Set(profile.interests).size !== profile.interests.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interests"],
        message: "No se permiten intereses duplicados.",
      });
    }
  });

export type UpdateSocialProfileInput = z.infer<typeof updateSocialProfileSchema>;

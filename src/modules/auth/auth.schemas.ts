import { z } from 'zod';

const normalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .max(180)
  .transform((emailAddress) => emailAddress.toLowerCase());

/**
 * Keeps the v1 request field `nombreCompleto` for compatibility while exposing
 * the validated value as the English internal identifier `fullName`.
 */
export const registerSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(8).max(128),
    nombreCompleto: z.string().trim().min(3).max(180),
  })
  .transform(({ nombreCompleto, ...credentials }) => ({
    ...credentials,
    fullName: nombreCompleto,
  }));

export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(8).max(128),
});

/** Body of `POST /auth/refresh` and `POST /auth/logout`. */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(20).max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

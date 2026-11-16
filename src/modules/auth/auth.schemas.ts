import { z } from 'zod';
import { UserGender } from '../../common/enums/domain.enums';
import { adultBirthDateSchema } from '../profiles/birth-date';

/** Moved to the legal catalog; re-exported for existing imports. */
export { CURRENT_TERMS_VERSION } from '../legal/legal-documents';

const normalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .max(180)
  .transform((emailAddress) => emailAddress.toLowerCase());

/**
 * Profile fields every new account declares, by password or by a provider.
 * Keeps the v1 request field `nombreCompleto` for compatibility; the transform
 * below exposes it as the English internal identifier `fullName`.
 */
const signupProfileShape = {
  nombreCompleto: z.string().trim().min(3).max(180),
  /**
   * Gimnasio al que se apunta la cuenta. Lo envía el cliente porque solo él
   * sabe por dónde entró la persona: la web lo resuelve por el dominio y una
   * compilación dedicada del móvil lo trae fijado. Si no llega, el servidor
   * usa `DEFAULT_TENANT_ID`; nunca se queda sin marca.
   */
  tenantId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(60)
    .optional(),
  /** Sex at signup is mandatory (product decision): only MALE or FEMALE. */
  genero: z.enum([UserGender.MALE, UserGender.FEMALE], {
    errorMap: () => ({ message: 'Elige tu sexo.' }),
  }),
  /** The app is 18+: same 18–100 rule as the profile, stored on the account. */
  fechaNacimiento: adultBirthDateSchema,
  /**
   * Version of the terms the client showed. The server compares it with the
   * current one (409 TERMS_VERSION_OUTDATED if it differs) instead of trusting it.
   */
  termsVersion: z.string({ required_error: 'Falta la versión de los términos.' }).trim().min(1).max(20),
  /**
   * Checkbox obligatorio del registro. No se guarda tal cual: su única función
   * es dejar pasar el alta; lo que persiste es la marca de tiempo y la versión
   * vigente, calculadas en el servidor y no en el cliente.
   */
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar los términos y la política de privacidad.' }),
  }),
};

/**
 * Anti-automation evidence of a password signup. All optional at the edge:
 * whether a missing piece rejects the signup is the antibot layer's decision.
 */
const signupEvidenceShape = {
  ticket: z.string().trim().min(1).max(4096).optional(),
  /** Honeypot: rendered hidden, humans leave it empty. */
  website: z.string().max(500).optional(),
  turnstileToken: z.string().trim().min(1).max(4096).optional(),
  attestation: z
    .object({
      platform: z.enum(['ios', 'android']),
      token: z.string().trim().min(1).max(16384),
      nonce: z.string().trim().min(1).max(512),
    })
    .optional(),
};

export const registerSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(8).max(128),
    ...signupProfileShape,
    ...signupEvidenceShape,
  })
  .transform(({ nombreCompleto, genero, fechaNacimiento, acceptedTerms: _acceptedTerms, ...credentials }) => ({
    ...credentials,
    fullName: nombreCompleto,
    gender: genero,
    birthDate: fechaNacimiento,
  }));

export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(8).max(128),
});

/** Raw opaque tokens are 32 random bytes hex-encoded — always exactly 64 characters. */
const opaqueTokenSchema = z.string().trim().length(64);

export const refreshTokenSchema = z.object({
  refreshToken: opaqueTokenSchema,
});

export const passwordResetRequestSchema = z.object({
  email: normalizedEmailSchema,
});

/**
 * Confirmación del PIN y contraseña nueva. El `email` es obligatorio junto al
 * PIN porque el PIN por sí solo no es único: seis dígitos son un millón de
 * valores y dos cuentas pueden coincidir por azar.
 *
 * El formato se valida en el borde: un PIN imposible no merece gastar un
 * `bcrypt.compare`, que es justo el trabajo que una fuerza bruta busca
 * hacernos gastar.
 */
export const passwordResetConfirmSchema = z.object({
  email: normalizedEmailSchema,
  pin: z.string().trim().regex(/^\d{6}$/u, 'El código son seis dígitos.'),
  password: z.string().min(8).max(128),
});

/** El gimnasio a mirar. Mismo formato que la clave del catálogo `tenants`. */
export const impersonateTenantSchema = z.object({
  tenantId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(60),
});

/** 6 digits, validated before any bcrypt work is spent on it. */
export const emailVerifyConfirmSchema = z.object({
  pin: z.string().trim().regex(/^\d{6}$/u, 'El código son seis dígitos.'),
});

/** Provider tokens are compact JWS; 8 KiB is far above any real one. */
const identityTokenSchema = z.string().trim().min(20).max(8192);
const nonceSchema = z.string().trim().min(1).max(512).optional();

export const googleSignInSchema = z.object({ idToken: identityTokenSchema, nonce: nonceSchema });
export const appleSignInSchema = z.object({ identityToken: identityTokenSchema, nonce: nonceSchema });

/** Same profile rules as the password signup, plus the token that proves the identity. */
export const identitySignupCompletionSchema = z
  .object({ signupToken: z.string().trim().min(20).max(4096), ...signupProfileShape })
  .transform(({ nombreCompleto, genero, fechaNacimiento, acceptedTerms: _acceptedTerms, ...rest }) => ({
    ...rest,
    fullName: nombreCompleto,
    gender: genero,
    birthDate: fechaNacimiento,
  }));

export type EmailVerifyConfirmInput = z.infer<typeof emailVerifyConfirmSchema>;
export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;
export type AppleSignInInput = z.infer<typeof appleSignInSchema>;
export type IdentitySignupCompletionInput = z.infer<typeof identitySignupCompletionSchema>;
export type ImpersonateTenantInput = z.infer<typeof impersonateTenantSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;

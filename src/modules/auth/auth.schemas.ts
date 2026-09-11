import { z } from 'zod';
import { UserGender } from '../../common/enums/domain.enums';

/**
 * Versión vigente de los términos y la política de privacidad.
 *
 * Sube cuando cambie el texto legal; las cuentas que ya aceptaron conservan la
 * versión que efectivamente vieron, no la vigente hoy — es lo que permite
 * saber más adelante a quién pedirle que vuelva a aceptar.
 */
export const CURRENT_TERMS_VERSION = '2026-08-25';

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
    /**
     * Opcional de verdad: la progresión tiene una rama neutra y nadie debería
     * tener que declarar su género para poder crear una cuenta.
     */
    genero: z.nativeEnum(UserGender).optional(),
    /**
     * Checkbox obligatorio del registro. No se guarda tal cual: su única función
     * es dejar pasar el alta; lo que persiste es la marca de tiempo y la versión
     * vigente, calculadas en el servidor y no en el cliente.
     */
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'Debes aceptar los términos y la política de privacidad.' }),
    }),
  })
  .transform(({ nombreCompleto, genero, acceptedTerms: _acceptedTerms, ...credentials }) => ({
    ...credentials,
    fullName: nombreCompleto,
    gender: genero ?? null,
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

export type ImpersonateTenantInput = z.infer<typeof impersonateTenantSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;

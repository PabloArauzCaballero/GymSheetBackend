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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Solicitud de PIN. Sólo el correo: pedir cualquier otro dato aquí sería
 * pedírselo a quien, por definición, no recuerda sus credenciales.
 */
export const passwordResetRequestSchema = z.object({
  email: normalizedEmailSchema,
});

/**
 * Confirmación del PIN y contraseña nueva.
 *
 * El PIN se valida como seis dígitos exactos en el borde: un formato imposible
 * no merece gastar un `bcrypt.compare`, que es justo el trabajo que un ataque
 * por fuerza bruta quiere hacernos gastar.
 */
export const passwordResetConfirmSchema = z.object({
  email: normalizedEmailSchema,
  pin: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/u, 'El código son seis dígitos.'),
  password: z.string().min(8).max(128),
});

export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;

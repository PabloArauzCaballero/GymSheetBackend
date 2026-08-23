import { z } from 'zod';
import { UserGender } from '../../common/enums/domain.enums';

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
  })
  .transform(({ nombreCompleto, genero, ...credentials }) => ({
    ...credentials,
    fullName: nombreCompleto,
    gender: genero ?? null,
  }));

export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

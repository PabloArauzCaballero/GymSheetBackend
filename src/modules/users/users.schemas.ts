import { z } from 'zod';
import { UserGender } from '../../common/enums/domain.enums';

/**
 * Ajustes de cuenta que la persona puede cambiar por su cuenta.
 *
 * El género se puede corregir siempre y en ambos sentidos, incluido volver a
 * `UNSPECIFIED`. Es un dato sobre quién es alguien: bloquearlo tras el registro
 * convertiría un descuido en una etiqueta permanente.
 */
export const updateMyAccountSchema = z
  .object({
    genero: z.nativeEnum(UserGender),
  })
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  });

export type UpdateMyAccountInput = z.infer<typeof updateMyAccountSchema>;

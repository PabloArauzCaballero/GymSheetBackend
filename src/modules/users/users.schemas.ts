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
    /**
     * Cuánto suma cada chip rápido («+2,5 kg») al registrar una serie. No
     * todos los gimnasios ni todos los discos son iguales; 2.5 era un valor
     * fijo del código, no una elección de nadie.
     */
    pesoIncrementoKg: z.number().positive().max(50),
  })
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  });

export type UpdateMyAccountInput = z.infer<typeof updateMyAccountSchema>;

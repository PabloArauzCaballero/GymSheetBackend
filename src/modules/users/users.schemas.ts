import { z } from 'zod';
import { UserGender } from '../../common/enums/domain.enums';
import { stripInvisibleCharacters } from '../../common/text/invisible-characters';

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
    /**
     * Sede habitual del socio. Se elige tras registrarse y solo puede ser una
     * sede activa de su propio gimnasio (lo comprueba el servicio).
     */
    sedeId: z.string().uuid(),
    /**
     * Unas líneas sobre ti, visibles en tu carta de Conocer. Se recorta y se
     * aplanan los saltos y caracteres de control: es una línea de carta, no un
     * documento. Se quitan los invisibles (`stripInvisibleCharacters`): una bio
     * de espacios de ancho cero o con la dirección invertida no es una bio.
     * Vacía o `null` la borra.
     */
    bio: z
      .string()
      .transform((value) =>
        stripInvisibleCharacters(value.replace(/\p{Cc}+/gu, " ")).replace(/\s+/g, " ").trim(),
      )
      .pipe(z.string().max(160, "La bio admite 160 caracteres como máximo."))
      .transform((value) => (value === "" ? null : value))
      .nullable(),
  })
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  });

export type UpdateMyAccountInput = z.infer<typeof updateMyAccountSchema>;

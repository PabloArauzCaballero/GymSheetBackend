import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import {
  ModerationTargetKind,
  ModerationTargetKindValue,
} from './moderation.policy';

const targetKindSchema = z.nativeEnum(ModerationTargetKind);

/**
 * Valida el tipo de contenido que viaja en la ruta.
 *
 * Sin esto llegaba al servicio como texto libre. No era explotable —el nombre
 * de tabla sale de un `switch` sobre un tipo cerrado, nunca del parámetro— pero
 * `/cases/CUALQUIER_COSA/<uuid>` respondía 404 como si el caso no existiera, en
 * vez de decir que el tipo no es válido. Un 404 que en realidad es un 400 manda
 * a buscar el fallo al sitio equivocado.
 */
@Injectable()
export class ModerationTargetKindPipe
  implements PipeTransform<string, ModerationTargetKindValue>
{
  transform(rawTargetKind: string): ModerationTargetKindValue {
    const parsed = targetKindSchema.safeParse(rawTargetKind);

    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tipo de contenido no reconocido.',
        issues: parsed.error.flatten(),
      });
    }

    return parsed.data;
  }
}

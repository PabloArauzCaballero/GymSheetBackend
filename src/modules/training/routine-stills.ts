import { ExerciseMediaType } from '../../common/enums/domain.enums';
import type { RoutineResponse } from './training.mapper';

/** Mejor imagen fija de un ejercicio: su lámina o, si no tiene, el póster de su vídeo. */
export type ExerciseStill = { url: string; esLamina: boolean };

/**
 * Reparte las imágenes fijas por el detalle de una rutina.
 *
 * El payload solo trae el medio principal de cada ejercicio, y el principal de
 * muchos es un vídeo sin póster aunque el ejercicio tenga lámina: la app
 * pintaba el glifo de reserva teniendo una foto a mano. Aquí:
 *  - cada ejercicio recibe `imagenUrl` (lámina, o póster si no hay lámina);
 *  - un vídeo principal sin póster toma la lámina como `thumbnailUrl`, para que
 *    los clientes que ya leen ese campo mejoren sin cambiar nada;
 *  - cada día recibe `portadaUrl`: la del primer ejercicio que tenga lámina y,
 *    si ninguno tiene, la del primero que tenga póster. Nunca un ejercicio sin imagen.
 */
export function applyRoutineStills(
  response: RoutineResponse,
  stills: ReadonlyMap<string, ExerciseStill>,
): void {
  const decorate = (item: RoutineResponse['ejercicios'][number]): ExerciseStill | null => {
    if (!item.ejercicio) return null;
    const still = stills.get(item.ejercicio.id) ?? null;
    item.ejercicio.imagenUrl = still?.url ?? null;
    if (still) {
      for (const media of item.ejercicio.media) {
        if (media.mediaType === ExerciseMediaType.VIDEO && !media.thumbnailUrl) media.thumbnailUrl = still.url;
      }
    }
    return still;
  };
  response.ejercicios.forEach(decorate);
  for (const day of response.dias) {
    const found = day.ejercicios.map(decorate).filter((still): still is ExerciseStill => still !== null);
    day.portadaUrl = (found.find((still) => still.esLamina) ?? found[0])?.url ?? null;
  }
}

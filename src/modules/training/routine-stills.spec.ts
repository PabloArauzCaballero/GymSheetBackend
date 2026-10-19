import { applyRoutineStills, ExerciseStill } from './routine-stills';
import type { RoutineResponse } from './training.mapper';

const item = (exerciseId: string, media: Array<{ mediaType: string; thumbnailUrl: string | null }> = []) =>
  ({ ejercicio: { id: exerciseId, media } }) as unknown as RoutineResponse['ejercicios'][number];

const routine = (days: Array<Array<ReturnType<typeof item>>>): RoutineResponse =>
  ({
    ejercicios: days.flat(),
    dias: days.map((ejercicios, index) => ({ id: `d${index}`, ejercicios })),
  }) as unknown as RoutineResponse;

const lamina = (url: string): ExerciseStill => ({ url, esLamina: true });
const poster = (url: string): ExerciseStill => ({ url, esLamina: false });

describe('applyRoutineStills', () => {
  it('cada ejercicio recibe su imagen y los que no tienen quedan en null', () => {
    const response = routine([[item('a'), item('b')]]);
    applyRoutineStills(response, new Map([['a', lamina('a.jpg')]]));
    expect(response.dias[0].ejercicios.map((e) => e.ejercicio?.imagenUrl)).toEqual(['a.jpg', null]);
    expect(response.ejercicios.map((e) => e.ejercicio?.imagenUrl)).toEqual(['a.jpg', null]);
  });

  it('un vídeo principal sin póster toma la lámina; uno con póster propio lo conserva', () => {
    const sinPoster = item('a', [{ mediaType: 'VIDEO', thumbnailUrl: null }]);
    const conPoster = item('b', [{ mediaType: 'VIDEO', thumbnailUrl: 'propio.webp' }]);
    applyRoutineStills(routine([[sinPoster, conPoster]]), new Map([['a', lamina('a.jpg')], ['b', lamina('b.jpg')]]));
    expect(sinPoster.ejercicio?.media[0].thumbnailUrl).toBe('a.jpg');
    expect(conPoster.ejercicio?.media[0].thumbnailUrl).toBe('propio.webp');
  });

  it('la portada del día salta los ejercicios sin imagen y prefiere una lámina a un póster', () => {
    const response = routine([
      [item('sin'), item('poster'), item('lamina')],
      [item('sin'), item('poster')],
      [item('sin')],
    ]);
    applyRoutineStills(response, new Map([['poster', poster('p.webp')], ['lamina', lamina('l.jpg')]]));
    expect(response.dias.map((d) => d.portadaUrl)).toEqual(['l.jpg', 'p.webp', null]);
  });
});

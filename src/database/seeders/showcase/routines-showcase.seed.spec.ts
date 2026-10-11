import { randomUUID } from 'node:crypto';
import { normalizeDayGroups } from '../../../modules/training/routine-groups';
import { createRoutineSchema } from '../../../modules/training/training.schemas';
import { EXERCISE_NAMES_ES } from './exercise-names-es.data';
import { RECOMMENDED_TEMPLATES } from './recommended-routines.data';
import { assertShowcaseAllowed, referencedExercises, resolveShowcasePassword } from './routines-showcase.seed';
import { COMMENTS, COMMUNITY_ROUTINES, DEMO_USERS, RATINGS } from './showcase-community.data';

describe('routines-showcase', () => {
  it('se niega a correr con NODE_ENV=production', () => {
    expect(() => assertShowcaseAllowed('production')).toThrow(/prohibido/u);
    expect(() => assertShowcaseAllowed('test')).not.toThrow();
  });

  it('exige una contraseña para las cuentas demo', () => {
    expect(() => resolveShowcasePassword({})).toThrow(/SEED_SHOWCASE_PASSWORD/u);
    expect(resolveShowcasePassword({ SEED_SHOWCASE_PASSWORD: 'demo-repp-2026' })).toBe('demo-repp-2026');
  });

  it('hay 20 plantillas con clave, nombre y número únicos', () => {
    expect(RECOMMENDED_TEMPLATES).toHaveLength(20);
    for (const key of ['plantilla', 'nombre', 'numero'] as const) {
      expect(new Set(RECOMMENDED_TEMPLATES.map((t) => t[key])).size).toBe(20);
    }
    expect(RECOMMENDED_TEMPLATES.every((t) => t.plantilla.startsWith('repp-'))).toBe(true);
  });

  it.each(RECOMMENDED_TEMPLATES.map((t) => [t.plantilla, t] as const))('%s pasa la validación real de la API', (_key, t) => {
    const ids = new Map<string, string>();
    const uuid = (id: string) => ids.get(id) ?? ids.set(id, randomUUID()).get(id)!;
    const parsed = createRoutineSchema.parse({
      nombre: t.nombre,
      descripcion: t.descripcion,
      objetivo: t.objetivo,
      duracionSemanas: t.duracionSemanas,
      progresion: { activa: true, ...t.progresion },
      dias: t.dias.map((d) => ({
        diaSemana: d.diaSemana,
        nombre: d.nombre,
        ejercicios: d.ejercicios.map((e) => ({
          ejercicioId: uuid(e.id),
          seriesObjetivo: e.series,
          repsMin: e.reps?.[0] ?? null,
          repsMax: e.reps?.[1] ?? null,
          rirObjetivo: e.rir,
          descansoSeg: e.descanso,
          nota: e.nota,
          grupo: e.grupo,
          descansoEntreSeg: e.entre,
          duracionSeg: e.seg,
        })),
      })),
    });
    // Bloques contiguos y de 2+ (lanza ROUTINE_GROUP_INVALID si no).
    for (const day of parsed.days ?? []) expect(() => normalizeDayGroups(day.exercises, day.name ?? '')).not.toThrow();
    expect(t.dias.length).toBeGreaterThanOrEqual(2);
    expect(t.dias.length).toBeLessThanOrEqual(6);
    for (const day of t.dias) {
      for (const e of day.ejercicios) {
        expect((e.reps === null) !== (e.seg === null)).toBe(true);
      }
    }
  });

  it('las superseries de dos son pares, no tríos sueltos, y solo «Vuelta suave» lleva aviso clínico', () => {
    for (const t of RECOMMENDED_TEMPLATES) {
      expect(t.aviso !== null).toBe(t.plantilla === 'repp-vuelta-suave');
      for (const day of t.dias) {
        const sizes = new Map<number, number>();
        for (const e of day.ejercicios) if (e.grupo != null) sizes.set(e.grupo, (sizes.get(e.grupo) ?? 0) + 1);
        for (const size of sizes.values()) expect(size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('todo ejercicio usado tiene nombre en español y los nombres en español no se repiten', () => {
    for (const id of referencedExercises().keys()) expect(EXERCISE_NAMES_ES[id]?.es).toBeTruthy();
    const es = Object.values(EXERCISE_NAMES_ES).map((n) => n.es);
    expect(new Set(es).size).toBe(es.length);
    expect(es.length).toBeGreaterThanOrEqual(300);
  });

  it('valoraciones de 3 a 5, sin autovaloración y con media 4,1–4,7', () => {
    const authorOf = new Map(COMMUNITY_ROUTINES.map((c) => [c.key, c.author]));
    for (const r of RATINGS) {
      const stars = r.stars.map(([, s]) => s);
      expect(stars.every((s) => s >= 3 && s <= 5)).toBe(true);
      expect(r.stars.every(([user]) => user !== authorOf.get(r.target))).toBe(true);
      const avg = stars.reduce((a, b) => a + b, 0) / stars.length;
      expect(avg).toBeGreaterThanOrEqual(4.1);
      expect(avg).toBeLessThanOrEqual(4.7);
    }
  });

  it('8 personas demo y un solo comentario moderado', () => {
    expect(DEMO_USERS).toHaveLength(8);
    expect(DEMO_USERS.every((u) => u.email.endsWith('@demo.repp.test'))).toBe(true);
    expect(COMMENTS.filter((c) => c.moderate)).toHaveLength(1);
  });
});

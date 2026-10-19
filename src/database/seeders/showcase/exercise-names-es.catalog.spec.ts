import { readFileSync } from 'fs';
import { resolve } from 'path';
import { gunzipSync } from 'zlib';
import { EXERCISE_NAMES_ES } from './exercise-names-es.data';
import { EXERCISE_NAMES_ES_BORRADOR } from './exercise-names-es.borrador.data';
import { FORBIDDEN_ENGLISH_TOKENS } from './exercise-names-es.glosario';
import { EXERCISE_NAMES_ES_CATALOG, reviewedSpanishNames, type CatalogSpanishName } from './exercise-names-es.catalog';

const snapshot: Array<{ external_id: string; nombre: string }> = JSON.parse(
  gunzipSync(readFileSync(resolve(__dirname, '../boot/exercises.snapshot.json.gz'))).toString('utf8'),
).exercises;

describe('catálogo de nombres en español (borrador + revisados)', () => {
  it('cubre el 100 % del snapshot, con el «en» exacto, sin vacíos y con longitud razonable', () => {
    for (const ex of snapshot) {
      const entry = EXERCISE_NAMES_ES_CATALOG[ex.external_id];
      expect(entry?.en).toBe(ex.nombre);
      expect(entry.es.trim().length).toBeGreaterThanOrEqual(2);
      expect(entry.es.length).toBeLessThanOrEqual(80);
    }
    expect(Object.keys(EXERCISE_NAMES_ES_CATALOG)).toHaveLength(snapshot.length);
  });

  it('los nombres en español no se repiten', () => {
    const es = Object.values(EXERCISE_NAMES_ES_CATALOG).map((n) => n.es.toLowerCase());
    expect(new Set(es).size).toBe(es.length);
  });

  it('los 343 revisados quedan revisado:true y todo el borrador revisado:false (por ahora)', () => {
    expect(Object.keys(EXERCISE_NAMES_ES)).toHaveLength(343);
    for (const id of Object.keys(EXERCISE_NAMES_ES)) expect(EXERCISE_NAMES_ES_CATALOG[id].revisado).toBe(true);
    for (const id of Object.keys(EXERCISE_NAMES_ES_BORRADOR)) expect(id in EXERCISE_NAMES_ES).toBe(false);
  });

  it('el borrador no deja palabras inglesas del glosario', () => {
    const forbidden = new Set(FORBIDDEN_ENGLISH_TOKENS);
    for (const [id, n] of Object.entries(EXERCISE_NAMES_ES_BORRADOR)) {
      const bad = n.es.toLowerCase().split(/[^a-záéíóúüñ0-9-]+/).filter((w) => forbidden.has(w));
      expect({ id, bad }).toEqual({ id, bad: [] });
    }
  });

  it('el sembrador solo recibe lo revisado: el borrador pendiente no se aplica', () => {
    const catalog: Record<string, CatalogSpanishName> = {
      a: { en: 'a', es: 'A', revisado: true },
      b: { en: 'b', es: 'B', revisado: false },
    };
    expect(reviewedSpanishNames(catalog).map(([id]) => id)).toEqual(['a']);
    const applied = reviewedSpanishNames();
    expect(applied.every(([, n]) => n.revisado)).toBe(true);
    expect(applied).toHaveLength(Object.keys(EXERCISE_NAMES_ES).length);
  });
});

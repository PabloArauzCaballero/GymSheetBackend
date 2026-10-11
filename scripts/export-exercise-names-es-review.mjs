#!/usr/bin/env node
/**
 * Genera la hoja de revisión docs/exercise-names-es-review.csv a partir del catálogo
 * (revisados + borrador). Columnas: id, nombre EN, nombre ES, revisado, comentario.
 * Tras activar un lote en `exercise-names-es.borrador.data.ts`, vuelve a ejecutarlo.
 * Uso: node scripts/export-exercise-names-es-review.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const showcase = resolve(root, 'src/database/seeders/showcase');
const { EXERCISE_NAMES_ES } = await import(`${showcase}/exercise-names-es.data.ts`);
const { EXERCISE_NAMES_ES_BORRADOR } = await import(`${showcase}/exercise-names-es.borrador.data.ts`);

/** Casos dudosos que la persona revisora debe mirar primero. */
const DOUBTS = {
  '0020': 'Aparato de equilibrio; confirmar si en el gimnasio se dice «tabla» o «plataforma».',
  '0137': 'Nombre original ambiguo («body-up»); traducción literal.',
  '0138': 'Nombre original ambiguo («bottoms-up»); revisar contra el vídeo.',
  '0161': 'Casi igual a 0164 («front shoulder raise»); se distinguen por «hacia delante» / «de hombro».',
  '0204': '«rear drive» en polea: movimiento poco claro; revisar contra el vídeo.',
  '0316': '«breeding» probablemente es una errata en origen; revisar contra el vídeo.',
  '0555': '«kick out sit»: traducción dudosa; revisar contra el vídeo.',
  '0777': '«spell caster»: traducción literal; confirmar nombre usado en español.',
  '0844': '«weighted round arm»: traducción literal; revisar contra el vídeo.',
  '0858': '«wind sprints»: podría ser «Sprints con cambio de ritmo».',
  '0859': '«wrist rollerer»: ejercicio con rodillo de muñeca.',
  '1496': '«sledge hammer»: golpe con mazo sobre neumático; confirmar nombre.',
  '1604': '«world greatest stretch»: nombre popular; confirmar si se deja en inglés.',
  '3119': '«potty squat»: traducción por función (sentadilla profunda).',
  '3304': '«skin the cat»: nombre gimnástico, se deja entre paréntesis.',
  '3292': '«elevator»: elemento de gimnasia/calistenia; se deja el nombre en inglés.',
  '0641': '«otis up»: nombre propio; sin traducción establecida.',
  '2271': '«left hook. boxing»: nombre con errata en origen.',
  '3295': 'Términos de calistenia (front/back lever, planche, maltesa) se dejan como en la comunidad hispana.',
  '1494': 'Postura de yoga: confirmar si se prefiere «Postura de la mariposa» o «Baddha Konasana».',
  '1371': 'Mismo ejercicio que 0088 en origen: se desambigua con «(variante 2)».',
  '0315': 'Casi idéntico a otro curl inclinado: se desambigua con «(variante 3)».',
  '3202': '«(hombre)/(mujer)» indica el modelo del vídeo y solo se conserva para distinguir duplicados.',
  '2335': '«calf press» (no raise): se tradujo «Press de talones».',
  '0108': 'Duplicado en origen de 1372; desambiguado con «apoyo en una pierna».',
};

const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const rows = [];
for (const [id, n] of Object.entries(EXERCISE_NAMES_ES)) rows.push([id, n.en, n.es, true]);
for (const [id, n] of Object.entries(EXERCISE_NAMES_ES_BORRADOR)) rows.push([id, n.en, n.es, n.revisado]);
rows.sort((a, b) => a[0].localeCompare(b[0]));
const lines = ['id,nombre_en,nombre_es,revisado,comentario'];
for (const [id, en, es, rev] of rows) lines.push([id, q(en), q(es), rev, q(DOUBTS[id] ?? '')].join(','));
writeFileSync(resolve(root, 'docs/exercise-names-es-review.csv'), lines.join('\n') + '\n');
console.log(`docs/exercise-names-es-review.csv: ${rows.length} filas, ${Object.keys(DOUBTS).length} con comentario`);

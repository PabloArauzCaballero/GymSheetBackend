#!/usr/bin/env node
/**
 * Verifica los nombres en español de los ejercicios SIN base de datos:
 * cobertura 100 % del snapshot, sin vacíos, sin duplicados, sin inglés residual,
 * longitud <= 80 y coherencia `en` <-> snapshot. Uso: node scripts/verify-exercise-names-es.mjs
 * (Node >= 22.18: importa los .ts directamente). Sale con código 1 si algo falla.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const showcase = resolve(root, 'src/database/seeders/showcase');
const { EXERCISE_NAMES_ES } = await import(`${showcase}/exercise-names-es.data.ts`);
const { EXERCISE_NAMES_ES_BORRADOR } = await import(`${showcase}/exercise-names-es.borrador.data.ts`);
const { FORBIDDEN_ENGLISH_TOKENS } = await import(`${showcase}/exercise-names-es.glosario.ts`);

const MAX_LENGTH = 80;
const snapshot = JSON.parse(
  gunzipSync(readFileSync(resolve(root, 'src/database/seeders/boot/exercises.snapshot.json.gz'))).toString('utf8'),
).exercises;

const all = new Map();
for (const [id, n] of Object.entries(EXERCISE_NAMES_ES)) all.set(id, { ...n, revisado: true });
for (const [id, n] of Object.entries(EXERCISE_NAMES_ES_BORRADOR)) {
  if (all.has(id)) fail(`id ${id} está en el diccionario revisado y en el borrador`);
  all.set(id, n);
}

const errors = [];
function fail(msg) { errors.push(msg); }
const forbidden = new Set(FORBIDDEN_ENGLISH_TOKENS);
const seen = new Map();
let covered = 0;

for (const ex of snapshot) {
  const id = ex.external_id;
  const entry = all.get(id);
  if (!entry) { fail(`sin traducción: ${id} «${ex.nombre}»`); continue; }
  covered += 1;
  if (entry.en !== ex.nombre) fail(`${id}: «en» no coincide con el snapshot («${entry.en}» vs «${ex.nombre}»)`);
  const es = (entry.es ?? '').trim();
  if (es.length < 2) fail(`${id}: traducción vacía`);
  if (es !== entry.es) fail(`${id}: espacios sobrantes`);
  if (es.length > MAX_LENGTH) fail(`${id}: ${es.length} caracteres (> ${MAX_LENGTH}): «${es}»`);
  if (es && es[0] !== es[0].toUpperCase()) fail(`${id}: debe empezar en mayúscula: «${es}»`);
  if (typeof entry.revisado !== 'boolean') fail(`${id}: falta la bandera «revisado»`);
  const key = es.toLowerCase();
  if (seen.has(key)) fail(`duplicado «${es}»: ${seen.get(key)} y ${id}`); else seen.set(key, id);
  const words = es.toLowerCase().split(/[^a-záéíóúüñ0-9-]+/).filter(Boolean);
  const bad = entry.revisado ? [] : words.filter((w) => forbidden.has(w)); // lo revisado a mano es la verdad
  if (bad.length) fail(`${id}: inglés residual [${bad.join(', ')}] en «${es}»`);
}
for (const id of all.keys()) if (!snapshot.some((e) => e.external_id === id)) fail(`${id}: no existe en el snapshot`);

const reviewed = [...all.values()].filter((n) => n.revisado).length;
console.log(`Snapshot: ${snapshot.length} ejercicios | traducidos: ${covered} (${((covered / snapshot.length) * 100).toFixed(1)} %)`);
console.log(`Revisados: ${reviewed} | borrador pendiente: ${all.size - reviewed}`);
console.log(`Duplicados ES: ${errors.filter((e) => e.startsWith('duplicado')).length} | inglés residual: ${errors.filter((e) => e.includes('inglés residual')).length}`);
if (errors.length) {
  console.error(`\n${errors.length} problema(s):`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('OK: cobertura 100 %, sin vacíos, sin duplicados, sin inglés residual, longitud <= ' + MAX_LENGTH);

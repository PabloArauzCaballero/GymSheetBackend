#!/usr/bin/env node
/**
 * Prepara la entrega de láminas abiertas emparejadas a mano.
 *
 * Lee `fuentes.json` (ejercicio del catálogo → foto de `free-exercise-db`,
 * revisada a ojo), descarga cada original (850 × 567 px), lo reescala a
 * 1.700 px con Real-ESRGAN —igual que `tools/laminas-hd`— y deja la carpeta que
 * carga `yarn db:media:laminas-abiertas --dir=<entrega> --apply`.
 *
 *   node tools/laminas-abiertas/preparar.mjs --realesrgan=/ruta/realesrgan-ncnn-vulkan --out=entrega-abiertas
 *   …  --solo=exacta,variante     # deja fuera las de implemento distinto
 *
 * Requisitos: `magick` y el binario `realesrgan-ncnn-vulkan` con `models/` al lado.
 * Reanudable: una lámina ya hecha en `--out` no se repite.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const TARGET_WIDTH = 1700;
const MODEL = 'realesrgan-x4plus';
const GENERADOR = `${MODEL} ×4 → Lanczos ${TARGET_WIDTH} px, JPEG q88`;

const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const bin = flag('realesrgan') ?? process.env.REALESRGAN_BIN;
const out = resolve(flag('out') ?? 'entrega-abiertas');
const only = (flag('solo') ?? 'exacta,variante,implemento').split(',');
if (!bin || !existsSync(bin)) throw new Error('Indica --realesrgan=<ruta a realesrgan-ncnn-vulkan> (o REALESRGAN_BIN).');

const fuentes = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fuentes.json'), 'utf8'));
const wanted = fuentes.laminas.filter((lamina) => only.includes(lamina.coincidencia));
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'laminas-abiertas-'));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const manifestPath = join(out, 'manifiesto.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).laminas : [];
const cache = new Map(previous.map((lamina) => [lamina.archivo, lamina]));
const done = [];
const save = () =>
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ generador: GENERADOR, fuente: fuentes.fuente, autor: fuentes.autor, licencia: fuentes.licencia, licenciaUrl: fuentes.licenciaUrl, laminas: done }, null, 2)}\n`,
  );

let index = 0;
for (const item of wanted) {
  index += 1;
  if (!/^[A-Za-z0-9_'.,()&-]+$/u.test(item.fed)) throw new Error(`Id de origen no válido: ${item.fed}`);
  const archivo = `${item.fed.replace(/[^A-Za-z0-9_-]/gu, '_')}_${item.n}.jpg`;
  const origenUrl = `${SOURCE_BASE}${encodeURIComponent(item.fed)}/${item.n}.jpg`;
  // La misma foto sirve a dos ejercicios (p. ej. rumano y piernas rígidas): se reescala una vez.
  let made = cache.get(archivo);
  if (!made || !existsSync(join(out, archivo))) {
    const response = await fetch(origenUrl);
    if (!response.ok) throw new Error(`${item.fed}/${item.n}: origen ${response.status}`);
    const source = Buffer.from(await response.arrayBuffer());
    const sourcePath = join(work, 'in.jpg');
    const bigPath = join(work, 'x4.png');
    writeFileSync(sourcePath, source);
    execFileSync(bin, ['-i', sourcePath, '-o', bigPath, '-n', MODEL, '-s', '4'], { cwd: dirname(bin), stdio: 'ignore' });
    execFileSync('magick', [bigPath, '-filter', 'Lanczos', '-resize', `${TARGET_WIDTH}x`, '-strip', '-sampling-factor', '4:2:0', '-interlace', 'JPEG', '-quality', '88', join(out, archivo)]);
    made = { archivo, sha256: sha256(readFileSync(join(out, archivo))), origenSha256: sha256(source) };
    cache.set(archivo, made);
    console.log(`[${index}/${wanted.length}] ${archivo}`);
  }
  done.push({
    ejercicio: item.ejercicio,
    en: item.en,
    externalId: `free-exercise-db:${item.fed}:${item.n}`,
    archivo,
    sha256: made.sha256,
    origenSha256: made.origenSha256,
    origenUrl,
    coincidencia: item.coincidencia,
    nota: item.nota,
  });
  save();
}
rmSync(work, { recursive: true, force: true });
console.log(`${done.length} láminas en ${out} (manifiesto.json incluido)`);

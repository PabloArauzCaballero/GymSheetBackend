#!/usr/bin/env node
/**
 * Reescala las láminas de ejercicio a 1.700 px de ancho con Real-ESRGAN.
 *
 * POR QUÉ: las láminas vienen de `yuhonas/free-exercise-db` y miden 850 × 567 px
 * (no hay original mayor). A sangre en un teléfono a 3× (1.206 px) se ven
 * blandas. El backend no procesa imágenes, así que esto corre FUERA, en una
 * máquina con GPU (un Mac sirve: ~14 s por lámina en Apple Silicon), y deja una
 * «entrega» que `yarn db:media:laminas-hd --dir=<entrega> --apply` carga.
 *
 * Requisitos: `magick` (ImageMagick) y el binario `realesrgan-ncnn-vulkan` con
 * su carpeta `models/` al lado (https://github.com/xinntao/Real-ESRGAN/releases).
 *
 *   node tools/laminas-hd/reescalar.mjs --realesrgan=/ruta/realesrgan-ncnn-vulkan \
 *        --pendientes=pendientes.json --out=entrega-hd
 *   node tools/laminas-hd/reescalar.mjs --realesrgan=… --ids=Split_Squats:0,Pullups:0 --out=entrega-hd
 *
 * `--pendientes` es el archivo que escribe `yarn db:media:laminas-hd --pendientes=…`.
 * Reanudable: una lámina ya reescalada en `--out` no se repite.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SOURCE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const PREFIX = 'free-exercise-db:';
const TARGET_WIDTH = 1700;
const MODEL = 'realesrgan-x4plus';
const GENERADOR = `${MODEL} ×4 → Lanczos ${TARGET_WIDTH} px, JPEG q88`;

const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const bin = flag('realesrgan') ?? process.env.REALESRGAN_BIN;
const out = resolve(flag('out') ?? 'entrega-hd');
if (!bin || !existsSync(bin)) throw new Error('Indica --realesrgan=<ruta a realesrgan-ncnn-vulkan> (o REALESRGAN_BIN).');

/** `free-exercise-db:<Id>:<n>` → { id, n }. Solo letras, números, guion y guion bajo: va a una URL y a un nombre de archivo. */
const parse = (externalId) => {
  const match = /^free-exercise-db:([A-Za-z0-9_'.,()&-]+):(\d)$/u.exec(externalId);
  return match ? { externalId, id: match[1], n: match[2] } : null;
};
const fromPending = flag('pendientes')
  ? JSON.parse(readFileSync(resolve(flag('pendientes')), 'utf8')).map((row) => row.externalId)
  : [];
const fromIds = (flag('ids') ?? '').split(',').filter(Boolean).map((id) => `${PREFIX}${id.includes(':') ? id : `${id}:0`}`);
const wanted = [...new Set([...fromPending, ...fromIds])].map(parse).filter(Boolean);
if (wanted.length === 0) throw new Error('Nada que reescalar: usa --pendientes=<archivo> o --ids=<Id:n,…>.');

mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'laminas-hd-'));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const safeName = (item) => `${item.id.replace(/[^A-Za-z0-9_-]/gu, '_')}_${item.n}.jpg`;
const manifestPath = join(out, 'manifiesto.json');
const laminas = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).laminas : [];
const done = new Map(laminas.map((lamina) => [lamina.externalId, lamina]));
const save = () =>
  writeFileSync(manifestPath, `${JSON.stringify({ generador: GENERADOR, laminas: [...done.values()] }, null, 2)}\n`);

let index = 0;
for (const item of wanted) {
  index += 1;
  const archivo = safeName(item);
  if (done.has(item.externalId) && existsSync(join(out, archivo))) continue;
  const response = await fetch(`${SOURCE_BASE}${encodeURIComponent(item.id)}/${item.n}.jpg`);
  if (!response.ok) {
    console.error(`[${index}/${wanted.length}] ${item.externalId}: origen ${response.status}, se salta`);
    continue;
  }
  const source = Buffer.from(await response.arrayBuffer());
  const sourcePath = join(work, 'in.jpg');
  const bigPath = join(work, 'x4.png');
  writeFileSync(sourcePath, source);
  execFileSync(bin, ['-i', sourcePath, '-o', bigPath, '-n', MODEL, '-s', '4'], { cwd: dirname(bin), stdio: 'ignore' });
  execFileSync('magick', [bigPath, '-filter', 'Lanczos', '-resize', `${TARGET_WIDTH}x`, '-strip', '-sampling-factor', '4:2:0', '-interlace', 'JPEG', '-quality', '88', join(out, archivo)]);
  done.set(item.externalId, {
    externalId: item.externalId,
    archivo,
    sha256: sha256(readFileSync(join(out, archivo))),
    origenSha256: sha256(source),
  });
  save();
  console.log(`[${index}/${wanted.length}] ${archivo}`);
}
save();
rmSync(work, { recursive: true, force: true });
console.log(`${done.size} láminas en ${out} (manifiesto.json incluido)`);

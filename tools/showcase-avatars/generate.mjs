#!/usr/bin/env node
/**
 * Genera los avatares de las cuentas de muestra (seed showcase).
 *
 * Son ILUSTRACIONES dibujadas aquí mismo, forma a forma: no hay fotos ni
 * rostros de personas reales, así que no hay licencia ni consentimiento que
 * pedir. Se rasterizan a WebP 512×512 y se incrustan en base64 en
 * `src/database/seeders/showcase/showcase-avatars.data.ts`, para que el seed los
 * suba al almacén sin depender de archivos sueltos en la imagen de Docker.
 *
 *   node tools/showcase-avatars/generate.mjs      # requiere rsvg-convert y cwebp o magick
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'src/database/seeders/showcase/showcase-avatars.data.ts');

/** bg: dos tonos del fondo · skin · hair · top (camiseta) · style: forma del pelo */
const PEOPLE = [
  { key: 'valentina.rios', bg: ['#F7B2C4', '#E05C8A'], skin: '#E8B48E', hair: '#3A2218', top: '#FFFFFF', style: 'long' },
  { key: 'mateo.fernandez', bg: ['#9AD0F5', '#3B82C4'], skin: '#D9A074', hair: '#1E1A17', top: '#16324F', style: 'short' },
  { key: 'camila.herrera', bg: ['#FFD59A', '#F08A3C'], skin: '#C98A5E', hair: '#22150F', top: '#2B2B2B', style: 'bun' },
  { key: 'diego.morales', bg: ['#C9E88A', '#6FAF1E'], skin: '#B97A4E', hair: '#17110D', top: '#F4F4F4', style: 'fade' },
  { key: 'lucia.navarro', bg: ['#A8E6DC', '#1F9E8F'], skin: '#F0C6A4', hair: '#7A4A22', top: '#103B36', style: 'pony' },
  { key: 'andres.castillo', bg: ['#D5C4F7', '#7C5CD6'], skin: '#E0AC84', hair: '#4A3020', top: '#FFFFFF', style: 'beard' },
  { key: 'sofia.paredes', bg: ['#9ED8F0', '#1F86A8'], skin: '#8E5A3A', hair: '#120C09', top: '#F2E9DC', style: 'curly' },
  { key: 'javier.ortega', bg: ['#B8EBD0', '#1E9A76'], skin: '#EBC09A', hair: '#B5651D', top: '#0F2F2A', style: 'short' },
];

const hairBack = (p) =>
  ({
    long: `<path d="M150 250c0-78 46-132 106-132s106 54 106 132v118c0 22-18 40-40 40H190c-22 0-40-18-40-40z" fill="${p.hair}"/>`,
    pony: `<path d="M318 150c58 6 86 60 74 132-6 34-22 62-40 80 6-52-2-110-34-150z" fill="${p.hair}"/>`,
    curly: `<g fill="${p.hair}"><circle cx="170" cy="212" r="46"/><circle cx="342" cy="212" r="46"/><circle cx="200" cy="150" r="50"/><circle cx="312" cy="150" r="50"/><circle cx="256" cy="126" r="54"/><circle cx="160" cy="268" r="36"/><circle cx="352" cy="268" r="36"/></g>`,
    bun: `<circle cx="256" cy="104" r="40" fill="${p.hair}"/>`,
  })[p.style] ?? '';

const hairFront = (p) =>
  ({
    long: `<path d="M172 236c0-58 36-96 84-96s84 38 84 96c-30-10-52-28-66-54-18 30-56 50-102 54z" fill="${p.hair}"/>`,
    pony: `<path d="M172 238c0-60 36-100 84-100s84 40 84 100c-24-22-50-36-84-40-34 4-60 18-84 40z" fill="${p.hair}"/>`,
    bun: `<path d="M172 240c0-62 36-102 84-102s84 40 84 102c-18-30-46-50-84-52-38 2-66 22-84 52z" fill="${p.hair}"/>`,
    curly: `<path d="M176 232c4-50 38-84 80-84s76 34 80 84c-22-22-48-34-80-34s-58 12-80 34z" fill="${p.hair}"/>`,
    short: `<path d="M170 244c-6-70 32-112 86-112s92 42 86 112c-10-34-30-54-56-62-36 10-74 10-102-2-8 16-12 38-14 64z" fill="${p.hair}"/>`,
    fade: `<path d="M174 232c-2-62 34-96 82-96s84 34 82 96c-8-36-34-58-82-58s-74 22-82 58z" fill="${p.hair}"/>`,
    beard: `<path d="M170 244c-6-70 32-112 86-112s92 42 86 112c-10-34-30-54-56-62-36 10-74 10-102-2-8 16-12 38-14 64z" fill="${p.hair}"/>
            <path d="M176 262c6 62 38 98 80 98s74-36 80-98c-10 30-30 44-52 46-10-8-18-10-28-10s-18 2-28 10c-22-2-42-16-52-46z" fill="${p.hair}"/>`,
  })[p.style];

const person = (p) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient>
    <linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="404" cy="96" r="150" fill="#fff" opacity="0.10"/>
  ${hairBack(p)}
  <path d="M96 512c0-88 72-140 160-140s160 52 160 140z" fill="${p.top}"/>
  <path d="M216 330h80v62c0 22-18 40-40 40s-40-18-40-40z" fill="${p.skin}"/>
  <path d="M216 352h80v26c-24 14-56 14-80 0z" fill="url(#sh)"/>
  <ellipse cx="256" cy="250" rx="84" ry="98" fill="${p.skin}"/>
  <ellipse cx="170" cy="258" rx="12" ry="20" fill="${p.skin}"/><ellipse cx="342" cy="258" rx="12" ry="20" fill="${p.skin}"/>
  ${hairFront(p)}
  <g fill="#1B1410"><ellipse cx="224" cy="262" rx="8" ry="10"/><ellipse cx="288" cy="262" rx="8" ry="10"/></g>
  <path d="M232 304c14 12 34 12 48 0" fill="none" stroke="#1B1410" stroke-opacity="0.75" stroke-width="6" stroke-linecap="round"/>
</svg>`;

const team = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0E1110"/>
  <circle cx="256" cy="256" r="176" fill="#C6F432"/>
  <g fill="#0E1110"><rect x="176" y="240" width="160" height="32" rx="10"/>
    <rect x="140" y="196" width="34" height="120" rx="12"/><rect x="338" y="196" width="34" height="120" rx="12"/>
    <rect x="108" y="220" width="26" height="72" rx="10"/><rect x="378" y="220" width="26" height="72" rx="10"/></g>
</svg>`;

const dir = mkdtempSync(join(tmpdir(), 'avatars-'));
const render = (key, svg) => {
  const svgPath = join(dir, `${key}.svg`);
  const pngPath = join(dir, `${key}.png`);
  const webpPath = join(dir, `${key}.webp`);
  writeFileSync(svgPath, svg);
  execFileSync('rsvg-convert', ['-w', '512', '-h', '512', '-o', pngPath, svgPath]);
  execFileSync('magick', [pngPath, '-quality', '90', '-define', 'webp:method=6', webpPath]);
  if (process.env.AVATAR_PREVIEW_DIR) writeFileSync(join(process.env.AVATAR_PREVIEW_DIR, `${key}.png`), readFileSync(pngPath));
  return readFileSync(webpPath).toString('base64');
};

const entries = [...PEOPLE.map((p) => [p.key, render(p.key, person(p))]), ['equipo', render('equipo', team)]];
writeFileSync(
  out,
  `/**
 * Avatares de las cuentas de muestra, en WebP 512×512 (base64).
 *
 * GENERADO por \`tools/showcase-avatars/generate.mjs\`: no editar a mano. Son
 * ilustraciones dibujadas por código —ninguna foto, ningún rostro real—, así
 * que se pueden distribuir con el repositorio sin licencia de terceros.
 */
export const SHOWCASE_AVATAR_MIME = 'image/webp';

export const SHOWCASE_AVATARS: Readonly<Record<string, string>> = {
${entries.map(([key, b64]) => `  '${key}':\n    '${b64}',`).join('\n')}
};
`,
);
console.log(`${entries.length} avatares → ${out}`);

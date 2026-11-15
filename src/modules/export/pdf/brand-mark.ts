import type { PdfFonts } from './fonts';
import { isReppBrand, type PdfBrand } from './theme';

/**
 * Isotipo y logotipo REPP en vectorial, copiados de
 * `apps/mobile/src/components/brand/mark.ts` (identidad REPP V1.0). No se
 * redibujan: si cambian allí, se copian aquí.
 */
const MARK_BOX = { x: 3, y: 19, width: 91, height: 82 } as const;
const MARK_BODY =
  'M25 19 H61 C82 19 94 31 88 48 C84 59 75 65 63 68 L88 101 H65 L42 70 H34 L24 101 H5 L25 19 Z M39 37 L34 54 H55 C64 54 70 50 71 43 C72 39 68 37 60 37 Z';
const MARK_TICK = 'M25 61 L48 37 H62 L34 71 L14 101 H3 Z';

const WORDMARK_BOX = { x: 20, y: 44, width: 622, height: 139 } as const;
const WORDMARK_R =
  'M63 44 H139 C177 44 195 65 187 91 C182 109 167 120 147 126 L188 183 H142 L106 131 H83 L66 183 H22 L62 44 Z M91 76 L82 105 H121 C136 105 146 98 148 88 C150 80 143 76 131 76 Z';
const WORDMARK_TICK = 'M62 119 L101 77 L126 77 L78 135 L45 183 L20 183 Z';
const WORDMARK_LETTERS = [
  'M213 44 H337 L327 76 H245 L237 99 H309 L300 128 H228 L220 151 H303 L293 183 H169 Z',
  'M357 44 H438 C476 44 494 63 485 94 C476 124 451 140 415 140 H379 L366 183 H326 Z M387 76 L378 109 H412 C427 109 438 101 441 89 C444 80 438 76 424 76 Z',
  'M505 44 H586 C624 44 642 63 633 94 C624 124 599 140 563 140 H527 L514 183 H474 Z M535 76 L526 109 H560 C575 109 586 101 589 89 C592 80 586 76 572 76 Z',
] as const;

type Ink = { body: string; tick: string; opacity?: number };

function drawPaths(
  doc: PDFKit.PDFDocument,
  box: { x: number; y: number; height: number },
  at: { x: number; y: number; height: number },
  paint: (scaled: PDFKit.PDFDocument) => void,
): void {
  const scale = at.height / box.height;
  doc.save();
  doc.translate(at.x, at.y).scale(scale).translate(-box.x, -box.y);
  paint(doc);
  doc.restore();
}

/** El signo «R» con su gesto, de alto `height`. Devuelve el ancho dibujado. */
export function drawReppMark(doc: PDFKit.PDFDocument, x: number, y: number, height: number, ink: Ink): number {
  drawPaths(doc, MARK_BOX, { x, y, height }, (d) => {
    d.fillOpacity(ink.opacity ?? 1);
    d.path(MARK_BODY).fill(ink.body, 'even-odd');
    d.path(MARK_TICK).fill(ink.tick);
  });
  return (MARK_BOX.width * height) / MARK_BOX.height;
}

/** El logotipo «REPP» completo. Devuelve el ancho dibujado. */
export function drawReppWordmark(doc: PDFKit.PDFDocument, x: number, y: number, height: number, ink: Ink): number {
  drawPaths(doc, WORDMARK_BOX, { x, y, height }, (d) => {
    d.path(WORDMARK_R).fill(ink.body, 'even-odd');
    d.path(WORDMARK_TICK).fill(ink.tick);
    for (const letter of WORDMARK_LETTERS) d.path(letter).fill(ink.body, 'even-odd');
  });
  return (WORDMARK_BOX.width * height) / WORDMARK_BOX.height;
}

/**
 * Logotipo de la marca activa. REPP usa su dibujo; un gimnasio con marca propia
 * conserva su monograma de texto sobre su acento (regla de `repp-diseno` §11).
 */
export function drawBrandLogo(
  doc: PDFKit.PDFDocument,
  brand: PdfBrand,
  fonts: PdfFonts,
  at: { x: number; y: number; height: number; text: string },
): number {
  if (isReppBrand(brand)) {
    return drawReppWordmark(doc, at.x, at.y, at.height, { body: at.text, tick: brand.accent });
  }
  const tile = at.height * 1.5;
  const tileY = at.y - (tile - at.height) / 2;
  doc.roundedRect(at.x, tileY, tile, tile, tile * 0.26).fill(brand.accent);
  doc.font(fonts.display).fontSize(tile * 0.42).fillColor(brand.accentContrast);
  doc.text(brand.monogram, at.x, tileY + tile * 0.27, { width: tile, align: 'center', lineBreak: false });
  doc.font(fonts.display).fontSize(at.height * 0.9).fillColor(at.text);
  doc.text(brand.wordmark, at.x + tile + 8, at.y + at.height * 0.02, { lineBreak: false, characterSpacing: 0.6 });
  return tile + 8 + doc.widthOfString(brand.wordmark, { characterSpacing: 0.6 });
}

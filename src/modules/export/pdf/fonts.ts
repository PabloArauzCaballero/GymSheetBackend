import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tipografías del informe: Bricolage Grotesque Bold (display de la marca REPP,
 * `fontFamilies.display` en la app) e Instrument Sans para el cuerpo. Ambas con
 * licencia SIL OFL 1.1 (textos en `fonts/*-OFL.txt`).
 *
 * Los .ttf viven junto a este archivo; `nest build` solo los copia a `dist/` si
 * `nest-cli.json` los declara como assets. Si faltan, el informe se dibuja con
 * Helvetica y se registra un aviso: nunca se rompe la descarga por una fuente.
 */
export type PdfFonts = {
  readonly display: string;
  readonly body: string;
  readonly bold: string;
};

const FILES = {
  display: 'BricolageGrotesque-Bold.ttf',
  body: 'InstrumentSans-Regular.ttf',
  bold: 'InstrumentSans-Bold.ttf',
} as const;

const FALLBACK: PdfFonts = { display: 'Helvetica-Bold', body: 'Helvetica', bold: 'Helvetica-Bold' };

export type FontBuffers = Record<keyof typeof FILES, Buffer>;

function warn(event: string, error: unknown): void {
  new Logger('PdfFonts').warn({ event, message: error instanceof Error ? error.message : String(error) });
}

let cache: FontBuffers | null | undefined;

function loadFontBuffers(): FontBuffers | null {
  if (cache !== undefined) return cache;
  const dir = join(__dirname, 'fonts');
  try {
    cache = {
      display: readFileSync(join(dir, FILES.display)),
      body: readFileSync(join(dir, FILES.body)),
      bold: readFileSync(join(dir, FILES.bold)),
    };
  } catch (error) {
    warn('export.pdf_fonts_missing', error);
    cache = null;
  }
  return cache;
}

/**
 * Registra las familias en el documento y devuelve sus nombres. Un archivo
 * dañado no tumba la descarga: se avisa y se dibuja con Helvetica.
 */
export function registerPdfFonts(doc: PDFKit.PDFDocument, buffers: FontBuffers | null = loadFontBuffers()): PdfFonts {
  if (!buffers) return FALLBACK;
  try {
    doc.registerFont('repp-display', buffers.display);
    doc.registerFont('repp-body', buffers.body);
    doc.registerFont('repp-bold', buffers.bold);
    // pdfkit no lee el archivo hasta usarlo: se fuerza aquí para fallar pronto.
    doc.font('repp-display').font('repp-body').font('repp-bold');
    return { display: 'repp-display', body: 'repp-body', bold: 'repp-bold' };
  } catch (error) {
    warn('export.pdf_fonts_invalid', error);
    doc.font(FALLBACK.body);
    return FALLBACK;
  }
}

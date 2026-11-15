import PDFDocument from 'pdfkit';
import { registerPdfFonts, type PdfFonts } from './fonts';
import { drawCompactHeader } from './header';
import { drawFooters } from './footer';
import { DEFAULT_TIME_ZONE } from './format';
import { createPdfTheme, isReppBrand, PAGE, type PdfBrand, type PdfTheme } from './theme';

export type PdfContext = {
  readonly doc: PDFKit.PDFDocument;
  readonly theme: PdfTheme;
  readonly fonts: PdfFonts;
  /** Título corto que repite la cabecera compacta. */
  readonly documentTitle: string;
  readonly generatedAt: Date;
  /** Zona IANA en la que se escriben fechas y se cuentan semanas. */
  readonly timeZone: string;
};

/**
 * Cursor vertical del contenido. Ningún bloque se parte: cada primitiva pide su
 * alto con `ensure` y, si no cabe, la página siguiente empieza con la cabecera
 * compacta.
 */
export class PdfLayout {
  y: number = PAGE.coverBandHeight + 26;

  constructor(readonly ctx: PdfContext) {}

  get doc(): PDFKit.PDFDocument {
    return this.ctx.doc;
  }

  get left(): number {
    return PAGE.marginX;
  }

  get width(): number {
    return this.doc.page.width - PAGE.marginX * 2;
  }

  get bottom(): number {
    return this.doc.page.height - PAGE.footerReserve;
  }

  fits(height: number): boolean {
    return this.y + height <= this.bottom;
  }

  ensure(height: number): void {
    if (!this.fits(height)) this.newPage();
  }

  newPage(): void {
    this.doc.addPage();
    drawCompactHeader(this.ctx);
    this.y = PAGE.compactTop;
  }
}

export type PdfDocumentOptions = {
  readonly brand: PdfBrand;
  /** Título de los metadatos y de la cabecera compacta. */
  readonly title: string;
  readonly subject: string;
  readonly generatedAt?: Date;
  readonly timeZone?: string;
};

/** Crea el documento, deja dibujar el contenido y numera las páginas al final. */
export async function renderPdf(options: PdfDocumentOptions, draw: (layout: PdfLayout) => void): Promise<Buffer> {
  const { brand } = options;
  const author = isReppBrand(brand) ? 'REPP' : `${brand.name} · REPP`;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    lang: 'es-ES',
    displayTitle: true,
    info: {
      Title: `${options.title} · ${options.subject}`,
      Author: author,
      Subject: options.title,
      Creator: 'REPP',
      Producer: 'REPP',
      Keywords: 'REPP, entrenamiento, progreso',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const ctx: PdfContext = {
    doc,
    theme: createPdfTheme(brand),
    fonts: registerPdfFonts(doc),
    documentTitle: options.title,
    generatedAt: options.generatedAt ?? new Date(),
    timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
  };

  draw(new PdfLayout(ctx));
  drawFooters(ctx);
  doc.end();
  return finished;
}

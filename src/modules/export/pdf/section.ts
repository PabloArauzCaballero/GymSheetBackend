import type { PdfLayout } from './document';
import { PAGE } from './theme';
import { fitLines, fitText } from './text-fit';

const SECTION_GAP = 22;
const TITLE_SIZE = 13.5;
const CAPTION_SIZE = 8;
const CAPTION_GAP = 16;

/**
 * Título de sección: barra corta de acento, título y filete. El rótulo va a la
 * derecha si cabe junto al título; si no, debajo, y el título se parte en dos
 * líneas como mucho. `keepWith` es el alto mínimo del contenido que debe
 * acompañarlo, para que un título nunca quede huérfano al pie.
 */
export function drawSectionTitle(layout: PdfLayout, title: string, options: { caption?: string; keepWith?: number } = {}): void {
  const { doc, ctx } = layout;
  const { colors, brand } = ctx.theme;
  const titleX = layout.left + 11;
  const titleWidth = layout.left + layout.width - titleX;
  const caption = options.caption ?? '';

  doc.font(ctx.fonts.body).fontSize(CAPTION_SIZE);
  const captionWidth = caption ? doc.widthOfString(caption) : 0;
  doc.font(ctx.fonts.display).fontSize(TITLE_SIZE);
  const inline = doc.widthOfString(title) + (caption ? captionWidth + CAPTION_GAP : 0) <= titleWidth;
  const text = inline ? title : fitLines(doc, title, titleWidth, 2);
  const titleHeight = inline ? doc.currentLineHeight(true) : doc.heightOfString(text, { width: titleWidth });
  const captionBelow = Boolean(caption) && !inline;
  const block = titleHeight + (captionBelow ? 13 : 0) + 15;

  if (layout.y > PAGE.compactTop) layout.y += SECTION_GAP;
  if (!layout.fits(block + (options.keepWith ?? 60))) layout.newPage();

  const y = layout.y;
  doc.roundedRect(layout.left, y + 1.5, 3.2, 14, 1.6).fill(brand.accent);
  doc.font(ctx.fonts.display).fontSize(TITLE_SIZE).fillColor(colors.ink);
  doc.text(text, titleX, y, inline ? { lineBreak: false } : { width: titleWidth });
  if (caption) {
    doc.font(ctx.fonts.body).fontSize(CAPTION_SIZE).fillColor(colors.muted);
    if (captionBelow) doc.text(fitText(doc, caption, titleWidth), titleX, y + titleHeight + 1, { lineBreak: false });
    else doc.text(caption, layout.left, y + 4.5, { width: layout.width, align: 'right', lineBreak: false });
  }
  doc.rect(layout.left, y + block - 9, layout.width, 0.6).fill(colors.hairline);
  layout.y = y + block;
}

/** Sección vacía: «Sin … .» en tono apagado. */
export function drawEmptyNote(layout: PdfLayout, text: string): void {
  const { doc, ctx } = layout;
  layout.ensure(22);
  doc.font(ctx.fonts.body).fontSize(9).fillColor(ctx.theme.colors.muted);
  doc.text(text, layout.left, layout.y + 2, { width: layout.width });
  layout.y += 22;
}

/** Alto que ocupará `drawSmallNote` (a lo sumo `MAX_NOTE_LINES` líneas). */
export function smallNoteHeight(layout: PdfLayout, text: string): number {
  layout.doc.font(layout.ctx.fonts.body).fontSize(7.5);
  return layout.doc.heightOfString(fitLines(layout.doc, text, layout.width, MAX_NOTE_LINES), { width: layout.width }) + 8;
}

/** Nota breve en tono apagado (descripciones, recortes). Nunca más de seis líneas. */
export function drawSmallNote(layout: PdfLayout, text: string): void {
  const { doc, ctx } = layout;
  const height = smallNoteHeight(layout, text);
  layout.ensure(height);
  doc.fillColor(ctx.theme.colors.muted).text(fitLines(doc, text, layout.width, MAX_NOTE_LINES), layout.left, layout.y + 6, {
    width: layout.width,
  });
  layout.y += height;
}

const MAX_NOTE_LINES = 6;
export const SUBHEADING_HEIGHT = 26;

export type InfoItem = { readonly label: string; readonly value: string };

/** Fila de tarjetas suaves con etiqueta en versales y valor. */
export function drawInfoCards(layout: PdfLayout, items: readonly InfoItem[], columns = items.length): void {
  const { doc, ctx } = layout;
  const gap = 10;
  const height = 48;
  const cardWidth = (layout.width - gap * (columns - 1)) / columns;

  for (let start = 0; start < items.length; start += columns) {
    layout.ensure(height);
    items.slice(start, start + columns).forEach((item, i) => {
      const x = layout.left + i * (cardWidth + gap);
      doc.roundedRect(x, layout.y, cardWidth, height, 9).fill(ctx.theme.cardFill);
      doc.font(ctx.fonts.bold).fontSize(6.3).fillColor(ctx.theme.colors.muted);
      doc.text(item.label.toUpperCase(), x + 12, layout.y + 11, {
        width: cardWidth - 24,
        characterSpacing: 1.2,
        lineBreak: false,
      });
      doc.font(ctx.fonts.bold).fontSize(10.5).fillColor(ctx.theme.colors.ink);
      doc.text(fitText(doc, item.value, cardWidth - 24), x + 12, layout.y + 24, { lineBreak: false });
    });
    layout.y += height + gap;
  }
  layout.y -= gap;
}

/** Rótulo pequeño en versales dentro de una sección («PRESCRIPCIÓN»). */
export function drawSubheading(layout: PdfLayout, text: string, keepWith = 60): void {
  const { doc, ctx } = layout;
  if (layout.y > PAGE.compactTop) layout.y += 10;
  layout.ensure(16 + keepWith);
  doc.font(ctx.fonts.bold).fontSize(7).fillColor(ctx.theme.brand.accentInkOnLight);
  doc.text(text.toUpperCase(), layout.left, layout.y, { characterSpacing: 1.4, lineBreak: false });
  layout.y += 16;
}

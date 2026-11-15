import type { PdfLayout } from './document';
import { fitText } from './text-fit';

export type KpiItem = {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  /** Línea de contexto bajo la cifra («62 min de media»). */
  readonly hint?: string;
};

const CARD_HEIGHT = 72;
const GAP = 10;

/**
 * Rejilla de cifras clave. La primera tarjeta lleva el filete de acento: un solo
 * dato destacado por superficie (política de acento de REPP).
 */
export function drawKpiGrid(layout: PdfLayout, items: readonly KpiItem[], columns = 3): void {
  const { doc, ctx } = layout;
  const { colors, brand } = ctx.theme;
  const cardWidth = (layout.width - GAP * (columns - 1)) / columns;

  for (let start = 0; start < items.length; start += columns) {
    layout.ensure(CARD_HEIGHT);
    items.slice(start, start + columns).forEach((item, i) => {
      const x = layout.left + i * (cardWidth + GAP);
      const y = layout.y;
      const inner = cardWidth - 28;
      doc.roundedRect(x, y, cardWidth, CARD_HEIGHT, 10).lineWidth(0.7).fillAndStroke(colors.page, colors.hairline);
      if (start + i === 0) {
        doc.save();
        doc.roundedRect(x, y, cardWidth, CARD_HEIGHT, 10).clip();
        doc.rect(x, y, cardWidth, 3).fill(brand.accent);
        doc.restore();
      }

      doc.font(ctx.fonts.bold).fontSize(6.3).fillColor(colors.muted);
      doc.text(fitText(doc, item.label.toUpperCase(), inner, 1.2), x + 14, y + 13, { characterSpacing: 1.2, lineBreak: false });

      doc.font(ctx.fonts.bold).fontSize(9);
      const unitWidth = item.unit ? doc.widthOfString(item.unit) + 4 : 0;
      // Una cifra enorme se achica en vez de salirse de la tarjeta.
      const size = valueFontSize(doc, ctx.fonts.display, item.value, inner - unitWidth);
      doc.font(ctx.fonts.display).fontSize(size).fillColor(colors.ink);
      const valueWidth = doc.widthOfString(item.value);
      doc.text(item.value, x + 14, y + 25 + (21 - size) * 0.8, { lineBreak: false });
      if (item.unit) {
        doc.font(ctx.fonts.bold).fontSize(9).fillColor(colors.muted);
        doc.text(item.unit, x + 14 + valueWidth + 4, y + 36, { lineBreak: false });
      }
      if (item.hint) {
        doc.font(ctx.fonts.body).fontSize(7.5).fillColor(colors.muted);
        doc.text(fitText(doc, item.hint, inner), x + 14, y + 54, { lineBreak: false });
      }
    });
    layout.y += CARD_HEIGHT + GAP;
  }
  layout.y -= GAP;
}

function valueFontSize(doc: PDFKit.PDFDocument, font: string, value: string, width: number): number {
  doc.font(font);
  let size = 21;
  while (size > 11 && doc.fontSize(size).widthOfString(value) > width) size -= 1;
  return size;
}

export type BarItem = { readonly label: string; readonly value: number; readonly display: string };

/** Barras horizontales proporcionales al mayor valor. */
export function drawBarList(layout: PdfLayout, items: readonly BarItem[]): void {
  const { doc, ctx } = layout;
  const { colors, brand } = ctx.theme;
  const max = Math.max(...items.map((item) => item.value), 1);
  const labelWidth = 140;
  const valueWidth = 90;
  const trackX = layout.left + labelWidth;
  const trackWidth = layout.width - labelWidth - valueWidth - 12;

  for (const item of items) {
    layout.ensure(22);
    const y = layout.y;
    doc.font(ctx.fonts.bold).fontSize(8.5).fillColor(colors.ink);
    doc.text(fitText(doc, item.label, labelWidth - 12), layout.left, y + 5, { lineBreak: false });
    doc.roundedRect(trackX, y + 7, trackWidth, 7, 3.5).fill(colors.zebra);
    const fill = Math.max(7, (trackWidth * item.value) / max);
    doc.roundedRect(trackX, y + 7, fill, 7, 3.5).fill(brand.accent);
    doc.font(ctx.fonts.bold).fontSize(8).fillColor(colors.muted);
    doc.text(item.display, layout.left + layout.width - valueWidth, y + 5, {
      width: valueWidth,
      align: 'right',
      lineBreak: false,
    });
    layout.y += 22;
  }
}

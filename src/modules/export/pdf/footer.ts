import { drawReppMark } from './brand-mark';
import type { PdfContext } from './document';
import { formatDate } from './format';
import { isReppBrand, PAGE } from './theme';

const BOTTOM_BAND = 8;

/**
 * Pie de todas las páginas. Se dibuja al final, con el documento ya completo,
 * para poder escribir «Página X de Y» (requiere `bufferPages`).
 */
export function drawFooters(ctx: PdfContext): void {
  const { doc, theme, fonts } = ctx;
  const { colors, brand } = theme;
  const range = doc.bufferedPageRange();
  const brandLine = isReppBrand(brand) ? 'REPP' : `${brand.name} · REPP`;
  const note = ` · Documento confidencial · Generado el ${formatDate(ctx.generatedAt, ctx.timeZone)}`;

  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    const width = doc.page.width;
    const height = doc.page.height;
    const left = PAGE.marginX;
    const right = width - PAGE.marginX;
    const baseline = height - 38;

    doc.rect(left, baseline - 12, right - left, 0.6).fill(colors.hairline);

    const markWidth = drawReppMark(doc, left, baseline - 0.5, 9, { body: colors.ink, tick: brand.accent });
    doc.font(fonts.bold).fontSize(7.5).fillColor(colors.ink);
    doc.text(brandLine, left + markWidth + 5, baseline, { lineBreak: false, continued: true });
    doc.font(fonts.body).fillColor(colors.muted).text(note, { lineBreak: false });

    const label = `Página ${index + 1} de ${range.count}`;
    doc.font(fonts.bold).fontSize(7.5);
    const pillWidth = doc.widthOfString(label) + 18;
    const pillX = right - pillWidth;
    doc.roundedRect(pillX, baseline - 4.5, pillWidth, 17, 8.5).fill(theme.groupFill);
    doc.fillColor(brand.accentInkOnLight).text(label, pillX, baseline, {
      width: pillWidth,
      align: 'center',
      lineBreak: false,
    });

    doc.rect(0, height - BOTTOM_BAND, width, BOTTOM_BAND).fill(colors.bandFrom);
    doc.rect(0, height - BOTTOM_BAND, 64, BOTTOM_BAND).fill(brand.accent);
  }
}

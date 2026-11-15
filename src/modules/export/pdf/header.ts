import { drawBrandLogo, drawReppMark } from './brand-mark';
import type { PdfContext } from './document';
import { formatDate } from './format';
import { isReppBrand, PAGE } from './theme';
import { fitText } from './text-fit';

export type CoverHeader = {
  /** Rótulo en versales sobre el título («INFORME DE ENTRENAMIENTO»). */
  readonly eyebrow: string;
  readonly title: string;
  /** Persona a la que pertenece el informe. */
  readonly subject: string;
};

const EYEBROW_SPACING = 1.6;

/** Banda oscura a sangre de la primera página. */
export function drawCoverHeader(ctx: PdfContext, header: CoverHeader): void {
  const { doc, theme, fonts } = ctx;
  const { colors, brand } = theme;
  const width = doc.page.width;
  const height = PAGE.coverBandHeight;
  const left = PAGE.marginX;
  const right = width - PAGE.marginX;

  doc.save();
  doc.rect(0, 0, width, height).clip();
  const band = doc.linearGradient(0, 0, width, height);
  band.stop(0, colors.bandFrom).stop(1, colors.bandTo);
  doc.rect(0, 0, width, height).fill(band);
  const glow = doc.radialGradient(width - 70, 10, 0, width - 70, 10, 260);
  glow.stop(0, brand.accent, 0.32).stop(1, brand.accent, 0);
  doc.rect(0, 0, width, height).fill(glow);
  // Marca de agua: el signo REPP grande, casi invisible. Solo con la marca REPP.
  if (isReppBrand(brand)) drawReppMark(doc, width - 135, 58, 135, { body: colors.bandText, tick: brand.accent, opacity: 0.07 });
  doc.restore();

  drawBrandLogo(doc, brand, fonts, { x: left, y: 30, height: 17, text: colors.bandText });

  doc.font(fonts.bold).fontSize(6.5).fillColor(colors.bandMuted);
  doc.text('FECHA DE GENERACIÓN', left, 31, {
    width: right - left,
    align: 'right',
    characterSpacing: EYEBROW_SPACING,
    lineBreak: false,
  });
  doc.font(fonts.bold).fontSize(11).fillColor(colors.bandText);
  doc.text(formatDate(ctx.generatedAt, ctx.timeZone), left, 42, { width: right - left, align: 'right', lineBreak: false });

  doc.font(fonts.bold).fontSize(7.5).fillColor(brand.accentInkOnDark);
  doc.text(header.eyebrow.toUpperCase(), left, 74, { characterSpacing: 2, lineBreak: false });
  doc.font(fonts.display).fontSize(27).fillColor(colors.bandText);
  doc.text(fitText(doc, header.title, right - left - 120), left, 87, { lineBreak: false });
  doc.font(fonts.body).fontSize(11.5).fillColor(colors.bandMuted);
  doc.text(fitText(doc, header.subject, right - left - 120), left, 124, { lineBreak: false });

  doc.rect(0, height, width, 3).fill(brand.accent);
}

/** Cabecera breve de las páginas siguientes: logotipo, título y filete. */
export function drawCompactHeader(ctx: PdfContext): void {
  const { doc, theme, fonts } = ctx;
  const left = PAGE.marginX;
  const right = doc.page.width - PAGE.marginX;

  doc.rect(0, 0, doc.page.width, 4).fill(theme.colors.bandFrom);
  doc.rect(0, 4, 64, 1.5).fill(theme.brand.accent);
  drawBrandLogo(doc, theme.brand, fonts, { x: left, y: 28, height: 12, text: theme.colors.ink });
  doc.font(fonts.bold).fontSize(7).fillColor(theme.colors.muted);
  doc.text(ctx.documentTitle.toUpperCase(), left, 31, {
    width: right - left,
    align: 'right',
    characterSpacing: EYEBROW_SPACING,
    lineBreak: false,
  });
  doc.rect(left, 52, right - left, 0.6).fill(theme.colors.hairline);
}

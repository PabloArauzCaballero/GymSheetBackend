import type { PdfLayout } from './document';
import { fitText } from './text-fit';
import { PAGE } from './theme';

export type TableColumn = {
  readonly header: string;
  /** Fracción del ancho útil; la suma de todas debe ser 1. */
  readonly width: number;
  readonly align?: 'left' | 'right' | 'center';
  readonly bold?: boolean;
  readonly muted?: boolean;
};

type GroupRow = { readonly kind: 'group'; readonly label: string; readonly meta?: string };

export type TableRow =
  | { readonly kind: 'row'; readonly cells: readonly string[] }
  /** Subcabecera que agrupa las filas siguientes (una sesión, un día). */
  | GroupRow;

const PAD_X = 8;
const PAD_Y = 6;
const FONT_SIZE = 8.2;
const HEAD_HEIGHT = 22;
const HEAD_GAP = 2;
const GROUP_HEIGHT = 22;
const MIN_ROW = 20;
const HINT = 16;
/** Alto de un título de sección de dos líneas con rótulo debajo. */
const TITLE_RESERVE = 70;

/** Medidas de una tabla: anchos, posiciones y alto (acotado) de cada fila. */
function tableMetrics(layout: PdfLayout, columns: readonly TableColumn[]) {
  const { doc, ctx } = layout;
  const widths = columns.map((column) => column.width * layout.width);
  const xs = widths.map((_, i) => layout.left + widths.slice(0, i).reduce((a, b) => a + b, 0));
  // Una fila nunca es más alta que una página vacía con título de sección,
  // cabecera, subcabecera y aviso: si lo fuera no cabría en ninguna, dejaría el
  // título solo en su página o se dibujaría sobre el pie.
  const maxRow = layout.bottom - PAGE.compactTop - TITLE_RESERVE - HEAD_HEIGHT - HEAD_GAP - GROUP_HEIGHT - HINT;
  const setCellFont = (column: TableColumn) => doc.font(column.bold ? ctx.fonts.bold : ctx.fonts.body).fontSize(FONT_SIZE);
  const rowHeight = (row: TableRow | undefined): number => {
    if (!row) return 0;
    if (row.kind === 'group') return GROUP_HEIGHT;
    const heights = row.cells.map((cell, i) => {
      setCellFont(columns[i]);
      return doc.heightOfString(cell || '—', { width: widths[i] - PAD_X * 2 });
    });
    return Math.min(maxRow, Math.max(MIN_ROW, Math.max(...heights) + PAD_Y * 2));
  };
  return { widths, xs, setCellFont, rowHeight };
}

/**
 * Alto mínimo con el que una tabla empieza: cabecera, primeras filas y aviso.
 * Lo usa el título de sección para no quedar huérfano al pie.
 */
export function tableLeadHeight(layout: PdfLayout, columns: readonly TableColumn[], rows: readonly TableRow[]): number {
  const { rowHeight } = tableMetrics(layout, columns);
  return HEAD_HEIGHT + HEAD_GAP + rowHeight(rows[0]) + rowHeight(rows[1]) + HINT;
}

/**
 * Tabla paginada. Una fila nunca se parte entre páginas; al saltar se avisa
 * «Continúa en la página siguiente» y la página nueva repite la cabecera y, si
 * la hay, la subcabecera del grupo en curso. Una celda que no cabría ni en una
 * página entera se recorta con «…».
 */
export function drawTable(layout: PdfLayout, columns: readonly TableColumn[], rows: readonly TableRow[]): void {
  const { doc, ctx } = layout;
  const { colors, brand } = ctx.theme;
  const { widths, xs, setCellFont, rowHeight } = tableMetrics(layout, columns);

  const drawHead = () => {
    doc.roundedRect(layout.left, layout.y, layout.width, HEAD_HEIGHT, 6).fill(colors.tableHead);
    doc.font(ctx.fonts.bold).fontSize(6.4).fillColor(colors.tableHeadText);
    columns.forEach((column, i) => {
      doc.text(column.header.toUpperCase(), xs[i] + PAD_X, layout.y + 8, {
        width: widths[i] - PAD_X * 2,
        align: column.align ?? 'left',
        characterSpacing: 0.6,
        lineBreak: false,
      });
    });
    layout.y += HEAD_HEIGHT + HEAD_GAP;
  };

  const drawGroup = (group: GroupRow, continued: boolean) => {
    const y = layout.y;
    doc.roundedRect(layout.left, y + 1, layout.width, GROUP_HEIGHT - 2, 5).fill(ctx.theme.groupFill);
    doc.rect(layout.left, y + 1, 2.5, GROUP_HEIGHT - 2).fill(brand.accent);
    doc.font(ctx.fonts.body).fontSize(7.8);
    const meta = fitText(doc, group.meta ?? '', layout.width * 0.5);
    const metaWidth = doc.widthOfString(meta);
    doc.fillColor(colors.muted).text(meta, layout.left, y + 7.5, {
      width: layout.width - PAD_X - 2,
      align: 'right',
      lineBreak: false,
    });
    doc.font(ctx.fonts.bold).fontSize(8.4).fillColor(brand.accentInkOnLight);
    const label = continued ? `${group.label} (continuación)` : group.label;
    doc.text(fitText(doc, label, layout.width - metaWidth - PAD_X * 4), layout.left + PAD_X + 4, y + 7, {
      lineBreak: false,
    });
    layout.y += GROUP_HEIGHT;
  };

  const breakPage = (group: GroupRow | null) => {
    doc.font(ctx.fonts.body).fontSize(7.5).fillColor(colors.muted);
    doc.text('Continúa en la página siguiente', layout.left, layout.y + 5, {
      width: layout.width,
      align: 'right',
      lineBreak: false,
    });
    layout.newPage();
    drawHead();
    if (group) drawGroup(group, true);
  };

  const drawRow = (cells: readonly string[], height: number, zebra: boolean) => {
    const y = layout.y;
    if (zebra) doc.rect(layout.left, y, layout.width, height).fill(colors.zebra);
    cells.forEach((cell, i) => {
      const column = columns[i];
      const width = widths[i] - PAD_X * 2;
      const text = cell || '—';
      setCellFont(column).fillColor(column.muted ? colors.muted : colors.ink);
      const room = height - PAD_Y * 2;
      const clamp = doc.heightOfString(text, { width }) > room + 0.5;
      doc.text(text, xs[i] + PAD_X, y + PAD_Y, {
        width,
        align: column.align ?? 'left',
        ...(clamp ? { height: room, ellipsis: true } : {}),
      });
    });
    doc.rect(layout.left, y + height - 0.5, layout.width, 0.5).fill(colors.hairline);
    layout.y = y + height;
  };

  layout.ensure(tableLeadHeight(layout, columns, rows));
  drawHead();

  let group: GroupRow | null = null;
  let zebra = 0;
  rows.forEach((row, index) => {
    const height = rowHeight(row);
    if (row.kind === 'group') {
      // La subcabecera nunca se queda sola al pie: viaja con su primera fila.
      if (!layout.fits(height + rowHeight(rows[index + 1]) + HINT)) breakPage(null);
      drawGroup(row, false);
      group = row;
      zebra = 0;
      return;
    }
    if (!layout.fits(height + HINT)) breakPage(group);
    drawRow(row.cells, height, zebra % 2 === 1);
    zebra += 1;
  });
}

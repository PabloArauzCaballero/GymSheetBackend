/**
 * Recorta `text` con «…» hasta que quepa en `width` con la fuente y el cuerpo
 * activos del documento. Para textos de una línea (tarjetas, cabeceras).
 */
export function fitText(doc: PDFKit.PDFDocument, text: string, width: number, characterSpacing = 0): string {
  const measure = (value: string) => doc.widthOfString(value, { characterSpacing });
  if (measure(text) <= width) return text;
  let end = text.length;
  while (end > 1 && measure(`${text.slice(0, end).trimEnd()}…`) > width) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/**
 * Recorta `text` con «…» hasta que ocupe como mucho `maxLines` líneas de
 * `width`. Para títulos que pueden partirse pero no crecer sin límite.
 */
export function fitLines(doc: PDFKit.PDFDocument, text: string, width: number, maxLines: number): string {
  const limit = doc.currentLineHeight(true) * maxLines + 0.5;
  const fits = (value: string) => doc.heightOfString(value, { width }) <= limit;
  if (fits(text)) return text;
  let low = 1;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(`${text.slice(0, mid).trimEnd()}…`)) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}

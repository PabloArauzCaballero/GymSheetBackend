export type ByteRange = { start: number; end: number };

/**
 * Interpreta una cabecera `Range` de un solo intervalo (`bytes=a-b`, `bytes=a-`,
 * `bytes=-n`). AVPlayer, el reproductor de iOS, pide audio y video por rangos y
 * da el archivo por inservible si recibe un 200 completo: así las notas de voz
 * salían como «Este audio ya no está disponible».
 *
 * `null`: sin cabecera, o una que no se entiende (varios intervalos, otra
 * unidad) — se responde el archivo entero, como permite RFC 9110.
 * `"unsatisfiable"`: el intervalo cae fuera del archivo → 416.
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return null;
  if (size === 0) return "unsatisfiable";

  if (startText === "") {
    const suffix = Number(endText);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

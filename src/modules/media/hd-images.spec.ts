import { hdManifestSchema, readJpegSize } from './hd-images';

/** JPEG mínimo: SOI + APP0 + SOF0 con las dimensiones pedidas. */
const jpeg = (width: number, height: number, marker = 0xc0): Buffer =>
  Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, marker, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

describe('readJpegSize', () => {
  it('lee ancho y alto de un JPEG de línea base y de uno progresivo', () => {
    expect(readJpegSize(jpeg(1700, 1134))).toEqual({ width: 1700, height: 1134 });
    expect(readJpegSize(jpeg(850, 567, 0xc2))).toEqual({ width: 850, height: 567 });
  });

  it('devuelve null si no es un JPEG o no trae cabecera de imagen', () => {
    expect(readJpegSize(Buffer.from('RIFFxxxxWEBP'))).toBeNull();
    expect(readJpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]))).toBeNull();
    expect(readJpegSize(Buffer.alloc(0))).toBeNull();
  });
});

describe('hdManifestSchema', () => {
  const lamina = { externalId: 'free-exercise-db:Split_Squats:0', archivo: 'Split_Squats_0.jpg', sha256: 'a'.repeat(64), origenSha256: 'b'.repeat(64) };

  it('acepta una entrega bien formada', () => {
    expect(hdManifestSchema.parse({ generador: 'realesrgan-x4plus → 1700 px', laminas: [lamina] }).laminas).toHaveLength(1);
  });

  it.each(['../fuera.jpg', 'carpeta/a.jpg', '/etc/passwd'])('rechaza la ruta %s (sale de la carpeta de la entrega)', (archivo) => {
    expect(() => hdManifestSchema.parse({ generador: 'x', laminas: [{ ...lamina, archivo }] })).toThrow();
  });

  it('rechaza un SHA-256 mal formado y una entrega vacía', () => {
    expect(() => hdManifestSchema.parse({ generador: 'x', laminas: [{ ...lamina, sha256: 'ABC' }] })).toThrow();
    expect(() => hdManifestSchema.parse({ generador: 'x', laminas: [] })).toThrow();
  });
});

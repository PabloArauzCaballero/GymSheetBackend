import { createHash } from 'crypto';
import { ExerciseMediaModel } from '../exercises/exercise-media.model';
import { HdImagesService } from './hd-images.service';
import { MediaStorageProvider } from './media-storage.port';

const jpeg = (width: number, height: number): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

describe('HdImagesService', () => {
  const hd = jpeg(1700, 1134);
  const manifest = {
    generador: 'realesrgan-x4plus → 1700 px',
    laminas: [{ externalId: 'free-exercise-db:Split_Squats:0', archivo: 'Split_Squats_0.jpg', sha256: sha(hd), origenSha256: 'b'.repeat(64) }],
  };
  const row = (over: Record<string, unknown> = {}) => ({
    exerciseId: 'e1',
    url: 'https://media/old.jpg',
    checksumSha256: 'old',
    metadata: { mirroredFrom: 'https://raw.githubusercontent.com/x/Split_Squats/0.jpg', source: 'yuhonas/free-exercise-db' },
    update: jest.fn(),
    ...over,
  });
  const storage = { upload: jest.fn() };
  const media = { findAll: jest.fn() };
  const service = new HdImagesService(media as unknown as typeof ExerciseMediaModel, storage as unknown as MediaStorageProvider);

  beforeEach(() => {
    jest.resetAllMocks();
    storage.upload.mockResolvedValue({ url: 'https://media/new.jpg', checksumSha256: sha(hd) });
  });

  it('sin --apply cuenta lo que haría y no escribe', async () => {
    const target = row();
    media.findAll.mockResolvedValue([target]);
    await expect(service.apply(manifest, () => hd, { apply: false })).resolves.toEqual({ candidates: 1, upgraded: 0, unchanged: 0, sinFila: 0 });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(target.update).not.toHaveBeenCalled();
  });

  it('sube la lámina a la carpeta del ejercicio y guarda dimensiones y procedencia sin perder mirroredFrom', async () => {
    const target = row();
    media.findAll.mockResolvedValue([target]);
    await expect(service.apply(manifest, () => hd, { apply: true })).resolves.toMatchObject({ upgraded: 1 });
    expect(storage.upload).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg' }), { category: 'ejercicios', exerciseId: 'e1' });
    expect(target.update).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://media/new.jpg',
        width: 1700,
        height: 1134,
        checksumSha256: sha(hd),
        metadata: expect.objectContaining({
          mirroredFrom: 'https://raw.githubusercontent.com/x/Split_Squats/0.jpg',
          hd: { generador: manifest.generador, origenSha256: 'b'.repeat(64), reemplaza: 'https://media/old.jpg' },
        }),
      }),
    );
  });

  it('una segunda pasada no cambia nada', async () => {
    media.findAll.mockResolvedValue([row({ checksumSha256: sha(hd) })]);
    await expect(service.apply(manifest, () => hd, { apply: true })).resolves.toEqual({ candidates: 1, upgraded: 0, unchanged: 1, sinFila: 0 });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['el archivo no es el del manifiesto', jpeg(1700, 1135), /SHA-256/u],
    ['no llega al ancho nítido', jpeg(850, 567), /al menos 1200/u],
  ])('rechaza la entrega entera si %s', async (_label, buffer, message) => {
    const laminas = [{ ...manifest.laminas[0], sha256: message.source.includes('SHA') ? manifest.laminas[0].sha256 : sha(buffer) }];
    await expect(service.apply({ ...manifest, laminas }, () => buffer, { apply: true })).rejects.toThrow(message);
    expect(media.findAll).not.toHaveBeenCalled();
  });

  it('una lámina sin fila activa se cuenta aparte y no rompe la carga', async () => {
    media.findAll.mockResolvedValue([]);
    await expect(service.apply(manifest, () => hd, { apply: true })).resolves.toEqual({ candidates: 0, upgraded: 0, unchanged: 0, sinFila: 1 });
  });
});

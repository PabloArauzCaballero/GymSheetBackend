import { createHash } from 'crypto';
import { ExerciseMediaModel } from '../exercises/exercise-media.model';
import { ExerciseModel } from '../exercises/exercise.model';
import { MediaStorageProvider } from './media-storage.port';
import { openStillsManifestSchema } from './open-stills';
import { OpenStillsService } from './open-stills.service';

const jpeg = (width: number, height: number): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

describe('OpenStillsService', () => {
  const hd = jpeg(1700, 1134);
  const lamina = {
    ejercicio: '0739',
    en: 'sled 45° leg press',
    externalId: 'free-exercise-db:Leg_Press:0',
    archivo: 'Leg_Press_0.jpg',
    sha256: sha(hd),
    origenSha256: 'b'.repeat(64),
    origenUrl: 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Leg_Press/0.jpg',
    coincidencia: 'exacta' as const,
    nota: null,
  };
  const manifest = openStillsManifestSchema.parse({
    generador: 'realesrgan-x4plus → 1700 px',
    fuente: 'yuhonas/free-exercise-db',
    autor: 'free-exercise-db contributors',
    licencia: 'Unlicense (public domain)',
    licenciaUrl: 'https://github.com/yuhonas/free-exercise-db/blob/main/LICENSE.md',
    laminas: [lamina],
  });
  const exercises = { findAll: jest.fn() };
  const media = { findOne: jest.fn(), count: jest.fn(), create: jest.fn() };
  const storage = { upload: jest.fn() };
  const service = new OpenStillsService(
    exercises as unknown as typeof ExerciseModel,
    media as unknown as typeof ExerciseMediaModel,
    storage as unknown as MediaStorageProvider,
  );
  const exercise = { id: 'e1', name: 'sled 45° leg press', externalId: '0739' };

  beforeEach(() => {
    jest.resetAllMocks();
    exercises.findAll.mockResolvedValue([exercise]);
    media.findOne.mockResolvedValue(null);
    media.count.mockResolvedValue(0);
    storage.upload.mockResolvedValue({ url: 'https://media/leg-press.jpg', checksumSha256: sha(hd) });
  });

  it('sin --apply cuenta lo que haría y no escribe', async () => {
    await expect(service.apply(manifest, () => hd, { apply: false })).resolves.toEqual({ total: 1, created: 1, updated: 0, unchanged: 0, sinEjercicio: 0 });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(media.create).not.toHaveBeenCalled();
  });

  it('crea la lámina como principal si el ejercicio no tiene medio, con licencia y procedencia', async () => {
    await service.apply(manifest, () => hd, { apply: true });
    expect(storage.upload).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg' }), { category: 'ejercicios', exerciseId: 'e1' });
    expect(media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseId: 'e1',
        externalId: 'free-exercise-db:Leg_Press:0',
        url: 'https://media/leg-press.jpg',
        width: 1700,
        height: 1134,
        isPrimary: true,
        sortOrder: 0,
        attribution: 'free-exercise-db contributors',
        license: 'Unlicense (public domain)',
        metadata: expect.objectContaining({
          source: 'yuhonas/free-exercise-db',
          mirroredFrom: lamina.origenUrl,
          emparejado: { modo: 'manual', coincidencia: 'exacta', nota: null },
        }),
      }),
    );
  });

  it('no le quita el puesto al vídeo principal: entra como secundaria', async () => {
    media.count.mockResolvedValue(1);
    await service.apply(manifest, () => hd, { apply: true });
    expect(media.create).toHaveBeenCalledWith(expect.objectContaining({ isPrimary: false, sortOrder: 50 }));
  });

  it('segunda pasada: la fila con ese mismo archivo no se toca', async () => {
    media.findOne.mockResolvedValue({ checksumSha256: sha(hd), status: 'ACTIVE', update: jest.fn() });
    await expect(service.apply(manifest, () => hd, { apply: true })).resolves.toMatchObject({ unchanged: 1, created: 0 });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('un ejercicio que no está en este catálogo se cuenta y se salta', async () => {
    exercises.findAll.mockResolvedValue([]);
    await expect(service.apply(manifest, () => hd, { apply: true })).resolves.toMatchObject({ sinEjercicio: 1, created: 0 });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('si el catálogo llama distinto al ejercicio no carga nada', async () => {
    exercises.findAll.mockResolvedValue([{ ...exercise, name: 'otro ejercicio' }]);
    await expect(service.apply(manifest, () => hd, { apply: true })).rejects.toThrow('No se carga nada');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rechaza un archivo que no llega al ancho nítido o cuyo SHA-256 no cuadra', async () => {
    const small = jpeg(850, 567);
    const bad = { ...manifest, laminas: [{ ...lamina, sha256: sha(small) }] };
    await expect(service.apply(bad, () => small, { apply: true })).rejects.toThrow('hacen falta al menos');
    await expect(service.apply(manifest, () => small, { apply: true })).rejects.toThrow('SHA-256');
  });
});

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { hdManifestSchema } from '../modules/media/hd-images';
import { HdImagesService } from '../modules/media/hd-images.service';
import { readFlag } from './exercise-media-command.shared';
import { MediaMaintenanceModule } from './media-maintenance.module';

/**
 * Láminas de ejercicio en alta resolución.
 *
 *   yarn db:media:laminas-hd --pendientes=pendientes.json     # qué falta por reescalar
 *   yarn db:media:laminas-hd --dir=entrega-hd                 # simulación
 *   yarn db:media:laminas-hd --dir=entrega-hd --apply         # carga real
 *
 * La entrega (`manifiesto.json` + los JPEG) la produce `tools/laminas-hd` en una
 * máquina con GPU; aquí solo se valida y se guarda. Seguro por defecto: sin
 * `--apply` informa y no escribe. Idempotente.
 */
async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const pendientes = readFlag(argv, 'pendientes');
  const dir = readFlag(argv, 'dir');
  const apply = argv.includes('--apply');
  if (!pendientes && !dir) throw new Error('Indica --pendientes=<archivo.json> o --dir=<carpeta de la entrega>.');

  const application = await NestFactory.createApplicationContext(MediaMaintenanceModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const service = application.get(HdImagesService);
    if (pendientes) {
      const rows = await service.pending();
      writeFileSync(resolve(pendientes), `${JSON.stringify(rows, null, 2)}\n`);
      Logger.log({ event: 'media.hd_images.pending', total: rows.length, archivo: resolve(pendientes) }, 'ExerciseImagesHd');
      return;
    }
    const folder = resolve(dir as string);
    const manifestPath = join(folder, 'manifiesto.json');
    if (!existsSync(manifestPath)) throw new Error(`No existe ${manifestPath}.`);
    const manifest = hdManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    const result = await service.apply(manifest, (archivo) => readFileSync(join(folder, archivo)), { apply });
    Logger.log({ event: apply ? 'media.hd_images.completed' : 'media.hd_images.dry_run', ...result }, 'ExerciseImagesHd');
  } finally {
    await application.close();
  }
}

run().catch((error: unknown) => {
  Logger.error(
    {
      event: 'media.hd_images.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
    'ExerciseImagesHd',
  );
  process.exitCode = 1;
});

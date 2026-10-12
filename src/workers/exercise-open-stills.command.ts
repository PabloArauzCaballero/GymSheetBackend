import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { openStillsManifestSchema } from '../modules/media/open-stills';
import { OpenStillsService } from '../modules/media/open-stills.service';
import { readFlag } from './exercise-media-command.shared';
import { MediaMaintenanceModule } from './media-maintenance.module';

/**
 * Láminas abiertas emparejadas a mano con ejercicios del catálogo.
 *
 *   node tools/laminas-abiertas/preparar.mjs --realesrgan=<bin> --out=entrega-abiertas
 *   yarn db:media:laminas-abiertas --dir=entrega-abiertas            # simulación
 *   yarn db:media:laminas-abiertas --dir=entrega-abiertas --apply    # carga real
 *
 * La tabla de equivalencias vive en `tools/laminas-abiertas/fuentes.json`.
 * Seguro por defecto: sin `--apply` informa y no escribe. Idempotente.
 */
async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const dir = readFlag(argv, 'dir');
  const apply = argv.includes('--apply');
  if (!dir) throw new Error('Indica --dir=<carpeta de la entrega>.');
  const folder = resolve(dir);
  const manifestPath = join(folder, 'manifiesto.json');
  if (!existsSync(manifestPath)) throw new Error(`No existe ${manifestPath}.`);
  const manifest = openStillsManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));

  const application = await NestFactory.createApplicationContext(MediaMaintenanceModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const result = await application
      .get(OpenStillsService)
      .apply(manifest, (archivo) => readFileSync(join(folder, archivo)), { apply });
    Logger.log({ event: apply ? 'media.open_stills.completed' : 'media.open_stills.dry_run', ...result }, 'ExerciseOpenStills');
  } finally {
    await application.close();
  }
}

run().catch((error: unknown) => {
  Logger.error(
    {
      event: 'media.open_stills.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
    'ExerciseOpenStills',
  );
  process.exitCode = 1;
});

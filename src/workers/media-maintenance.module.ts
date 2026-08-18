import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { env } from "../config/env";
import { createMediaStorageProvider } from "../modules/media/media-storage.factory";
import { MEDIA_STORAGE_PROVIDER } from "../modules/media/media-storage.port";
import {
  MEDIA_MIRROR_CONFIG,
  MediaMirrorConfig,
  MediaMirrorService,
} from "../modules/media/media-mirror.service";
import { ExerciseMediaModel } from "../modules/exercises/exercise-media.model";
import { MediaFileModel } from "../modules/membership/media-file.model";
import { DatabaseModule } from "../database/database.module";

/**
 * Contexto mínimo para el comando de mirroring de media: conexión a la base de
 * datos, el modelo de archivos y el proveedor de almacenamiento configurado.
 * Sin superficie HTTP ni workers.
 */
@Module({
  imports: [
    DatabaseModule,
    SequelizeModule.forFeature([MediaFileModel, ExerciseMediaModel]),
  ],
  providers: [
    MediaMirrorService,
    {
      provide: MEDIA_STORAGE_PROVIDER,
      useFactory: () =>
        createMediaStorageProvider({
          provider: env.MEDIA_STORAGE_PROVIDER,
          localRoot: env.MEDIA_STORAGE_LOCAL_ROOT,
          publicBaseUrl: env.MEDIA_STORAGE_PUBLIC_BASE_URL,
        }),
    },
    {
      provide: MEDIA_MIRROR_CONFIG,
      useValue: {
        allowedHosts: env.MEDIA_MIRROR_ALLOWED_HOSTS,
        maxBytes: env.MEDIA_UPLOAD_MAX_BYTES,
        timeoutMs: env.MEDIA_MIRROR_TIMEOUT_MS,
        publicBaseUrl: env.MEDIA_STORAGE_PUBLIC_BASE_URL,
      } satisfies MediaMirrorConfig,
    },
  ],
})
export class MediaMaintenanceModule {}

import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { env } from "../../config/env";
import { MediaFileModel } from "../membership/media-file.model";
import { MediaController } from "./media.controller";
import { MediaRepository } from "./media.repository";
import {
  MEDIA_UPLOAD_CONFIG,
  MediaService,
  MediaUploadConfig,
} from "./media.service";
import { MediaReferencesRepository } from "./media-references.repository";
import { MediaRetentionService } from "./media-retention.service";
import { createMediaStorageProvider } from "./media-storage.factory";
import { MEDIA_STORAGE_PROVIDER } from "./media-storage.port";

@Module({
  imports: [SequelizeModule.forFeature([MediaFileModel])],
  controllers: [MediaController],
  providers: [
    MediaRepository,
    MediaService,
    MediaReferencesRepository,
    MediaRetentionService,
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
      provide: MEDIA_UPLOAD_CONFIG,
      useValue: {
        allowedMimeTypes: env.MEDIA_ALLOWED_MIME.map((mime) =>
          mime.toLowerCase(),
        ),
        maxBytes: env.MEDIA_UPLOAD_MAX_BYTES,
      } satisfies MediaUploadConfig,
    },
  ],
  exports: [MediaService, MediaRetentionService, MEDIA_STORAGE_PROVIDER],
})
export class MediaModule {}

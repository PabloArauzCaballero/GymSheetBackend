import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { env } from "../../config/env";
import {
  MediaListQuery,
  MediaUploadMetadata,
  mediaListQuerySchema,
  mediaUploadMetadataSchema,
} from "./media.schemas";
import { MediaService, UploadedMultipartFile } from "./media.service";

@Roles(UserRole.ADMIN)
@Controller("admin/media")
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(mediaListQuerySchema)) query: MediaListQuery,
  ) {
    return this.mediaService.list(query.limit);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: env.MEDIA_UPLOAD_MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedMultipartFile | undefined,
    @Body(new ZodValidationPipe(mediaUploadMetadataSchema))
    metadata: MediaUploadMetadata,
  ) {
    return this.mediaService.upload(file, metadata);
  }
}

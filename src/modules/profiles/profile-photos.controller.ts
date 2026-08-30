import { Controller, Delete, Get, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { ProfilePhotosService, UploadedProfilePhoto } from "./profile-photos.service";

/** Galería de fotos de perfil del socio autenticado. No es la mediateca administrada por el gimnasio. */
@Controller("me/photos")
export class ProfilePhotosController {
  constructor(private readonly service: ProfilePhotosService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: env.MEDIA_UPLOAD_MAX_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedProfilePhoto | undefined,
  ) {
    return this.service.upload(user.id, file);
  }

  @Delete(":id")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) photoId: string,
  ) {
    return this.service.remove(user.id, photoId);
  }
}

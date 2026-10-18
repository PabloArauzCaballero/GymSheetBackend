import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { parseByteRange } from "../chat/chat-media-range";
import { StoriesService, StoryUploadOptions, UploadedStoryMedia } from "./stories.service";
import { StoryReactionsService } from "./story-reactions.service";

/** Stories: foto/video que expira a las 24h, visible solo para el autor y sus matches. */
@Controller("me/stories")
export class StoriesController {
  constructor(
    private readonly service: StoriesService,
    private readonly reactions: StoryReactionsService,
  ) {}

  @Get("feed")
  feed(@CurrentUser() user: AuthenticatedUser) {
    return this.service.feed(user.id);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: env.CHAT_MEDIA_MAX_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedStoryMedia | undefined,
    @Body() options: StoryUploadOptions,
  ) {
    return this.service.upload(user.id, user.tenantId, file, options);
  }

  @Get(":id/media")
  // Caché privada y corta: la story es inmutable (la clave es el SHA-256 del
  // contenido), así que el teléfono puede reutilizar lo precargado sin volver a
  // bajarlo. Diez minutos acotan lo que sobrevive en el dispositivo de quien ya
  // tenía acceso si la story se borra o se le retira el permiso.
  @Header("Cache-Control", "private, max-age=600")
  @Header("X-Content-Type-Options", "nosniff")
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) storyId: string,
    @Headers("range") rangeHeader: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const media = await this.service.downloadMedia(storyId, user.id);
    response.setHeader("ETag", media.etag);
    if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === media.etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return new StreamableFile(Buffer.alloc(0), { type: media.mimeType });
    }
    // Por rangos (206), como los medios del chat: AVPlayer pide el vídeo a
    // trozos y da por inservible un 200 completo, así que en iPhone las
    // stories de vídeo se quedaban en «Este vídeo no se pudo cargar».
    const size = media.buffer.length;
    response.setHeader("Accept-Ranges", "bytes");
    const range = parseByteRange(rangeHeader, size);
    if (range === "unsatisfiable") {
      response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      response.setHeader("Content-Range", `bytes */${size}`);
      return new StreamableFile(Buffer.alloc(0), { type: media.mimeType });
    }
    if (range) {
      response.status(HttpStatus.PARTIAL_CONTENT);
      response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      return new StreamableFile(media.buffer.subarray(range.start, range.end + 1), {
        type: media.mimeType,
        disposition: "inline",
      });
    }
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: "inline" });
  }

  @Get(":id/viewers")
  viewers(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) storyId: string) {
    return this.service.viewers(storyId, user.id, user.tenantId);
  }

  @Post(":id/view")
  view(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) storyId: string) {
    return this.service.view(storyId, user.id);
  }

  @Post(":id/reactions")
  react(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) storyId: string,
    @Body() body: unknown,
  ) {
    return this.reactions.reactToStory(storyId, user.id, user.tenantId, body);
  }

  @Post(":id/replies")
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) storyId: string,
    @Body() body: unknown,
  ) {
    return this.reactions.replyToStory(storyId, user.id, user.tenantId, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) storyId: string) {
    return this.service.remove(storyId, user.id);
  }
}

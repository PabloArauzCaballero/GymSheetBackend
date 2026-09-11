import { Controller, Delete, Get, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { StoriesService, UploadedStoryMedia } from "./stories.service";

/** Stories: foto/video que expira a las 24h, visible solo para el autor y sus matches. */
@Controller("me/stories")
export class StoriesController {
  constructor(private readonly service: StoriesService) {}

  @Get("feed")
  feed(@CurrentUser() user: AuthenticatedUser) {
    return this.service.feed(user.id, user.tenantId);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: env.CHAT_MEDIA_MAX_BYTES, files: 1 } }))
  upload(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: UploadedStoryMedia | undefined) {
    return this.service.upload(user.id, user.tenantId, file);
  }

  @Get(":id/viewers")
  viewers(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) storyId: string) {
    return this.service.viewers(storyId, user.id, user.tenantId);
  }

  @Post(":id/view")
  view(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) storyId: string) {
    return this.service.view(storyId, user.id, user.tenantId);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) storyId: string) {
    return this.service.remove(storyId, user.id);
  }
}

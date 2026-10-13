import { Body, Controller, Delete, Get, Header, Param, Post, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
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
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) storyId: string,
  ): Promise<StreamableFile> {
    const media = await this.service.downloadMedia(storyId, user.id);
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

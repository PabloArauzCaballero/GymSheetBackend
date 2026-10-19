import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { ReelSocialService, ReelTab } from "./reel-social.service";
import { ReelsService } from "./reels.service";

export interface UploadedReelMedia {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

@Controller("me/reels")
export class ReelsController {
  constructor(
    private readonly service: ReelsService,
    private readonly social: ReelSocialService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: env.CHAT_MEDIA_MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedReelMedia | undefined,
    @Body("requestId") requestId?: string,
  ) {
    return this.service.upload(user.id, user.tenantId, file, requestId);
  }

  @Get("feed")
  feed(
    @CurrentUser() user: AuthenticatedUser,
    @Query("tab") tab?: string,
    @Query("cursor") cursor?: string,
  ) {
    if (tab && !["MINE", "FOR_YOU", "CONNECTIONS"].includes(tab)) {
      throw new BadRequestException(
        "tab debe ser MINE, FOR_YOU o CONNECTIONS.",
      );
    }
    if (cursor !== undefined && (cursor.length === 0 || cursor.length > 500)) {
      throw new BadRequestException(
        "cursor debe tener entre 1 y 500 caracteres.",
      );
    }
    return this.service.feed(
      user.id,
      (tab as ReelTab | undefined) ?? "MINE",
      cursor,
    );
  }

  @Get("saved")
  saved(@CurrentUser() user: AuthenticatedUser) {
    return this.social.saved(user.id);
  }

  @Post(":id/save")
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
    @Body("saved") saved: unknown,
  ) {
    if (typeof saved !== "boolean")
      throw new BadRequestException("saved debe ser boolean.");
    return this.social.toggleSave(user.id, reelId, saved);
  }

  @Post(":id/repost")
  repost(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
    @Body("reposted") reposted: unknown,
  ) {
    if (typeof reposted !== "boolean")
      throw new BadRequestException("reposted debe ser boolean.");
    return this.social.toggleRepost(user.id, reelId, reposted);
  }

  @Post(":id/like")
  like(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
    @Body("liked") liked: unknown,
  ) {
    if (typeof liked !== "boolean")
      throw new BadRequestException("liked debe ser boolean.");
    return this.social.toggleLike(user.id, reelId, liked);
  }

  @Get(":id/comments")
  comments(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
  ) {
    return this.social.comments(user.id, reelId);
  }

  @Post(":id/comments")
  comment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
    @Body() body: { body?: unknown; parentCommentId?: unknown },
  ) {
    if (typeof body?.body !== "string")
      throw new BadRequestException("body debe ser texto.");
    if (
      body.parentCommentId !== undefined &&
      typeof body.parentCommentId !== "string"
    ) {
      throw new BadRequestException("parentCommentId debe ser un UUID.");
    }
    return this.social.createComment(
      user.id,
      reelId,
      body.body,
      body.parentCommentId,
    );
  }

  @Delete(":id/comments/:commentId")
  deleteComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
    @Param("commentId", UuidParamPipe) commentId: string,
  ) {
    return this.social.deleteComment(user.id, reelId, commentId);
  }

  @Patch(":id/comments")
  commentsEnabled(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
    @Body("enabled") enabled: unknown,
  ) {
    if (typeof enabled !== "boolean")
      throw new BadRequestException("enabled debe ser boolean.");
    return this.social.setCommentsEnabled(user.id, reelId, enabled);
  }

  @Delete(":id")
  deleteReel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
  ) {
    return this.social.deleteReel(user.id, reelId);
  }

  @Get(":id/media")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) reelId: string,
  ): Promise<StreamableFile> {
    const media = await this.service.downloadMedia(reelId, user.id);
    return new StreamableFile(media.buffer, {
      type: media.mimeType,
      disposition: "inline",
    });
  }
}

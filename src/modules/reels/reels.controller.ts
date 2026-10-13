import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Param,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { ReelsService } from "./reels.service";

export interface UploadedReelMedia {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/** Own reels only until connection-based feeds and moderation are implemented. */
@Controller("me/reels")
export class ReelsController {
  constructor(private readonly service: ReelsService) {}

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
  feed(@CurrentUser() user: AuthenticatedUser) {
    return this.service.feed(user.id);
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

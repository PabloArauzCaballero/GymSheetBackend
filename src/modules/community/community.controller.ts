import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { env } from '../../config/env';
import { GiphyService } from './giphy.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { CommunityService, UploadedCommentFile } from './community.service';
import {
  CommentInput,
  CommentListQuery,
  ContentKind,
  GifSearchQuery,
  gifSearchQuerySchema,
  RatingInput,
  commentListQuerySchema,
  commentSchema,
  contentKindParam,
  ratingSchema,
} from './community.schemas';

const kindPipe = new ZodValidationPipe(contentKindParam);

@Controller()
export class CommunityController {
  constructor(
    private readonly community: CommunityService,
    private readonly giphy: GiphyService,
  ) {}

  @Get('comments/gifs')
  gifs(@Query(new ZodValidationPipe(gifSearchQuerySchema)) query: GifSearchQuery) {
    return this.giphy.search(query);
  }

  @Post('comments/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env.CHAT_MEDIA_MAX_BYTES, files: 1 } }))
  uploadMedia(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedCommentFile | undefined,
  ) {
    return this.community.uploadAttachment(user, file);
  }

  @Get('ratings/:kind/:id')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', kindPipe) kind: ContentKind,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.community.summary(user, kind, id);
  }

  @Put('ratings/:kind/:id')
  rate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', kindPipe) kind: ContentKind,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(ratingSchema)) input: RatingInput,
  ) {
    return this.community.rate(user, kind, id, input.stars);
  }

  @Delete('ratings/:kind/:id')
  removeRating(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', kindPipe) kind: ContentKind,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.community.removeRating(user, kind, id);
  }

  @Get('comments/:kind/:id')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', kindPipe) kind: ContentKind,
    @Param('id', UuidParamPipe) id: string,
    @Query(new ZodValidationPipe(commentListQuerySchema)) query: CommentListQuery,
  ) {
    return this.community.list(user, kind, id, query);
  }

  @Post('comments/:kind/:id')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', kindPipe) kind: ContentKind,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(commentSchema)) input: CommentInput,
  ) {
    return this.community.create(user, kind, id, input);
  }

  @Delete('comments/:commentId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', UuidParamPipe) commentId: string,
  ) {
    return this.community.remove(user, commentId);
  }

  @Put('comments/:commentId/like')
  like(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', UuidParamPipe) commentId: string,
  ) {
    return this.community.setLike(user, commentId, true);
  }

  @Delete('comments/:commentId/like')
  unlike(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', UuidParamPipe) commentId: string,
  ) {
    return this.community.setLike(user, commentId, false);
  }
}

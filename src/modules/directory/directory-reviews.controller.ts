import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { DirectoryService } from './directory.service';
import {
  CreateEntityBody,
  CreateReviewBody,
  CreateReviewReplyBody,
  UpdateReviewBody,
  createEntityBodySchema,
  createReviewBodySchema,
  createReviewReplyBodySchema,
  updateReviewBodySchema,
} from './directory.schemas';

@Controller('directory')
export class DirectoryReviewsController {
  constructor(private readonly service: DirectoryService) {}

  @Post('entities/:id/reviews')
  @HttpCode(HttpStatus.CREATED)
  createReview(
    @Param('id', UuidParamPipe) entityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createReviewBodySchema)) body: CreateReviewBody
  ) {
    return this.service.createReview(entityId, user.id, body);
  }

  @Patch('reviews/:id')
  updateReview(
    @Param('id', UuidParamPipe) reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateReviewBodySchema)) body: UpdateReviewBody
  ) {
    return this.service.updateReview(reviewId, user.id, body);
  }

  @Delete('reviews/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteReview(
    @Param('id', UuidParamPipe) reviewId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.service.deleteReview(reviewId, user.id, user.role);
  }

  @Post('reviews/:id/helpful')
  @HttpCode(HttpStatus.OK)
  toggleHelpful(
    @Param('id', UuidParamPipe) reviewId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.service.toggleHelpfulVote(reviewId, user.id);
  }

  @Post('reviews/:id/reply')
  @HttpCode(HttpStatus.CREATED)
  replyToReview(
    @Param('id', UuidParamPipe) reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createReviewReplyBodySchema)) body: CreateReviewReplyBody
  ) {
    return this.service.replyToReview(reviewId, user.id, user.role, body);
  }

  @Delete('reviews/:id/reply')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteReviewReply(
    @Param('id', UuidParamPipe) reviewId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.service.deleteReviewReply(reviewId, user.id, user.role);
  }

  @Post('entities')
  @HttpCode(HttpStatus.CREATED)
  createEntity(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createEntityBodySchema)) body: CreateEntityBody
  ) {
    return this.service.createEntity(user, body);
  }
}

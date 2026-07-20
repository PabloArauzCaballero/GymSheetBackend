import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ExerciseMediaService } from './exercise-media.service';
import {
  CreateExerciseMediaInput,
  createExerciseMediaSchema,
} from './exercises.schemas';

@Controller('exercises/:exerciseId/media')
export class ExerciseMediaController {
  constructor(private readonly mediaService: ExerciseMediaService) {}

  @Get()
  listMedia(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('exerciseId', UuidParamPipe) exerciseId: string,
  ) {
    return this.mediaService.listMedia(authenticatedUser, exerciseId);
  }

  @Post()
  addMedia(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('exerciseId', UuidParamPipe) exerciseId: string,
    @Body(new ZodValidationPipe(createExerciseMediaSchema))
    input: CreateExerciseMediaInput,
  ) {
    return this.mediaService.addMedia(authenticatedUser, exerciseId, input);
  }
}

@Controller('exercise-media')
export class ExerciseMediaManagementController {
  constructor(private readonly mediaService: ExerciseMediaService) {}

  @Delete(':mediaId')
  removeMedia(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('mediaId', UuidParamPipe) mediaId: string,
  ) {
    return this.mediaService.removeMedia(authenticatedUser, mediaId);
  }
}

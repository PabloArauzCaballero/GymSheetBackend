import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import {
  ExerciseMediaService,
  UploadedExerciseMedia,
} from './exercise-media.service';
import {
  CreateExerciseMediaInput,
  createExerciseMediaSchema,
  UploadExerciseMediaInput,
  uploadExerciseMediaSchema,
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

  /**
   * Sube el archivo y lo asocia, frente a `POST` a secas, que solo registra una
   * URL externa. El binario queda en `ejercicios/<id>/` del almacenamiento
   * configurado: el mismo MinIO que sirve el resto de la red social.
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: env.EXERCISE_MEDIA_MAX_BYTES, files: 1 },
    }),
  )
  uploadMedia(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('exerciseId', UuidParamPipe) exerciseId: string,
    @UploadedFile() file: UploadedExerciseMedia | undefined,
    @Body(new ZodValidationPipe(uploadExerciseMediaSchema))
    input: UploadExerciseMediaInput,
  ) {
    return this.mediaService.uploadMedia(
      authenticatedUser,
      exerciseId,
      file,
      input,
    );
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

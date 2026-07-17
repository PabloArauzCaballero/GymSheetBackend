import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { ExerciseType, UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import {
  ExerciseMediaResponse,
  mapExerciseMediaToResponse,
} from './exercise.mapper';
import { ExerciseMediaRepository } from './exercise-media.repository';
import { ExerciseModel } from './exercise.model';
import { ExercisesRepository } from './exercises.repository';
import { CreateExerciseMediaInput } from './exercises.schemas';

const MAX_ACTIVE_MEDIA_PER_EXERCISE = 10;

@Injectable()
export class ExerciseMediaService {
  constructor(
    private readonly exercisesRepository: ExercisesRepository,
    private readonly mediaRepository: ExerciseMediaRepository,
    private readonly sequelize: Sequelize,
  ) {}

  async listMedia(
    authenticatedUser: AuthenticatedUser,
    exerciseId: string,
  ): Promise<ExerciseMediaResponse[]> {
    await this.findVisibleExerciseOrFail(exerciseId, authenticatedUser.id);
    const mediaItems = await this.mediaRepository.listActiveByExercise(exerciseId);
    return mediaItems.map(mapExerciseMediaToResponse);
  }

  async addMedia(
    authenticatedUser: AuthenticatedUser,
    exerciseId: string,
    input: CreateExerciseMediaInput,
  ): Promise<ExerciseMediaResponse> {
    const exercise = await this.findVisibleExerciseOrFail(exerciseId, authenticatedUser.id);
    this.assertCanManageMedia(authenticatedUser, exercise);

    const activeMediaCount = await this.mediaRepository.countActiveByExercise(exerciseId);

    if (activeMediaCount >= MAX_ACTIVE_MEDIA_PER_EXERCISE) {
      throw new ConflictException(
        `Un ejercicio no puede tener más de ${MAX_ACTIVE_MEDIA_PER_EXERCISE} archivos multimedia activos.`,
      );
    }

    const media = await this.sequelize.transaction(async (transaction) => {
      const shouldBePrimary = input.isPrimary || activeMediaCount === 0;

      if (shouldBePrimary) {
        await this.mediaRepository.clearPrimary(exerciseId, transaction);
      }

      return this.mediaRepository.create(
        {
          ...input,
          exerciseId,
          isPrimary: shouldBePrimary,
          createdByUserId: authenticatedUser.id,
        },
        transaction,
      );
    });

    return mapExerciseMediaToResponse(media);
  }

  async removeMedia(
    authenticatedUser: AuthenticatedUser,
    mediaId: string,
  ): Promise<{ deleted: true }> {
    const media = await this.mediaRepository.findActiveById(mediaId);

    if (!media?.exercise) {
      throw new NotFoundException('Archivo multimedia no encontrado.');
    }

    this.assertCanManageMedia(authenticatedUser, media.exercise);

    await this.sequelize.transaction(async (transaction) => {
      const wasPrimary = media.isPrimary;
      await this.mediaRepository.markInactive(media, transaction);

      if (wasPrimary) {
        await this.mediaRepository.promoteFirstActive(media.exerciseId, transaction);
      }
    });

    return { deleted: true };
  }

  private async findVisibleExerciseOrFail(
    exerciseId: string,
    userId: string,
  ): Promise<ExerciseModel> {
    const exercise = await this.exercisesRepository.findVisibleById(exerciseId, userId);

    if (!exercise) {
      throw new NotFoundException('Ejercicio no encontrado o no visible para el usuario.');
    }

    return exercise;
  }

  private assertCanManageMedia(
    authenticatedUser: AuthenticatedUser,
    exercise: ExerciseModel,
  ): void {
    const canManageGlobal =
      exercise.type === ExerciseType.GLOBAL && authenticatedUser.role === UserRole.ADMIN;
    const canManagePersonal =
      exercise.type === ExerciseType.PERSONAL &&
      exercise.createdByUserId === authenticatedUser.id;

    if (!canManageGlobal && !canManagePersonal) {
      throw new ForbiddenException(
        'No tienes permisos para modificar los archivos multimedia de este ejercicio.',
      );
    }
  }
}

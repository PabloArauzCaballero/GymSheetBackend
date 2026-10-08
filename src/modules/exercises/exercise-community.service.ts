import { Injectable, NotFoundException } from '@nestjs/common';
import { ExerciseType } from '../../common/enums/domain.enums';
import { ExerciseCommunityRepository } from './exercise-community.repository';
import { ExerciseResponse } from './exercise.mapper';
import { ExercisesRepository } from './exercises.repository';

export type LikeResponse = { meGusta: boolean; meGustaTotal: number };

@Injectable()
export class ExerciseCommunityService {
  constructor(
    private readonly community: ExerciseCommunityRepository,
    private readonly exercises: ExercisesRepository,
  ) {}

  /** Añade `meGusta` y `esFavorito` (lo que sabe quien mira) a cada ejercicio. */
  async decorate<T extends ExerciseResponse>(items: readonly T[], userId: string): Promise<T[]> {
    const flags = await this.community.viewerFlags(userId, items.map((i) => i.id));
    return items.map((item) => ({
      ...item,
      meGusta: flags.liked.has(item.id),
      esFavorito: flags.favorite.has(item.id),
    }));
  }

  /** Visible = global, propio, o alcanzable desde una rutina que el usuario puede ver. Si no, 404. */
  async assertReadable(exerciseId: string, userId: string): Promise<void> {
    const own = await this.exercises.findVisibleById(exerciseId, userId);
    if (own) return;
    const raw = await this.community.findAnyById(exerciseId);
    if (
      raw &&
      raw.type === ExerciseType.PERSONAL &&
      (await this.community.isReachableViaRoutine(exerciseId, userId))
    ) {
      return;
    }
    throw new NotFoundException('Ejercicio no encontrado.');
  }

  async setLike(userId: string, exerciseId: string, liked: boolean): Promise<LikeResponse> {
    await this.assertReadable(exerciseId, userId);
    const total = await this.community.setLike(userId, exerciseId, liked);
    return { meGusta: liked, meGustaTotal: total };
  }
}

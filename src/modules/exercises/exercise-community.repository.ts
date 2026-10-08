import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { exerciseVisibleSql } from '../../common/sql/content-visibility';
import { ExerciseLikeModel } from '../community/exercise-like.model';
import { ExerciseModel } from './exercise.model';
import { UserExercisePreferenceModel } from './muscles/user-exercise-preference.model';

/** Me gusta público, favorito privado y alcance de un ejercicio a través de rutinas visibles (D3, D7). */
@Injectable()
export class ExerciseCommunityRepository {
  constructor(
    @InjectModel(ExerciseLikeModel) private readonly likeModel: typeof ExerciseLikeModel,
    @InjectModel(UserExercisePreferenceModel)
    private readonly preferenceModel: typeof UserExercisePreferenceModel,
    @InjectModel(ExerciseModel) private readonly exerciseModel: typeof ExerciseModel,
  ) {}

  async viewerFlags(userId: string, exerciseIds: readonly string[]) {
    if (exerciseIds.length === 0) return { liked: new Set<string>(), favorite: new Set<string>() };
    const [likes, prefs] = await Promise.all([
      this.likeModel.findAll({ where: { userId, exerciseId: [...exerciseIds] } }),
      this.preferenceModel.findAll({ where: { userId, exerciseId: [...exerciseIds], isFavorite: true } }),
    ]);
    return {
      liked: new Set(likes.map((l) => l.exerciseId)),
      favorite: new Set(prefs.map((p) => p.exerciseId)),
    };
  }

  /** Inserta el me gusta y ajusta el contador en la MISMA transacción. Idempotente. */
  async setLike(userId: string, exerciseId: string, liked: boolean): Promise<number> {
    const sequelize = this.exerciseModel.sequelize!;
    return sequelize.transaction(async (transaction) => {
      if (liked) {
        const [, created] = await this.likeModel.findOrCreate({
          where: { userId, exerciseId },
          defaults: { userId, exerciseId },
          transaction,
        });
        if (created) await this.exerciseModel.increment('likesCount', { where: { id: exerciseId }, transaction });
      } else {
        const removed = await this.likeModel.destroy({ where: { userId, exerciseId }, transaction });
        if (removed > 0) await this.exerciseModel.decrement('likesCount', { where: { id: exerciseId }, transaction });
      }
      const row = await this.exerciseModel.findByPk(exerciseId, { attributes: ['likesCount'], transaction });
      return row?.likesCount ?? 0;
    });
  }

  /**
   * ¿Llega este ejercicio al usuario por una rutina que sí puede ver? Es lo que
   * permite abrir la ficha de un ejercicio privado de otra persona desde una
   * rutina pública o compartida (D3), y nada más.
   */
  async isReachableViaRoutine(exerciseId: string, userId: string): Promise<boolean> {
    const rows = await this.exerciseModel.sequelize!.query<{ ok: number }>(
      `SELECT 1 AS ok FROM public.ejercicios e
        WHERE e.id = :exerciseId AND ${exerciseVisibleSql('e', ':userId')} LIMIT 1`,
      { replacements: { exerciseId, userId }, type: QueryTypes.SELECT },
    );
    return rows.length > 0;
  }

  findAnyById(exerciseId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findByPk(exerciseId);
  }
}

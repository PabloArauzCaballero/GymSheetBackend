import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ExerciseMediaStatus } from '../../common/enums/domain.enums';
import { hasOpenReportSql } from '../../common/moderation/open-report.sql';
import { ExerciseMediaModel } from './exercise-media.model';
import { ExerciseModel } from './exercise.model';
import { CreateExerciseMediaInput } from './exercises.schemas';

export type CreateExerciseMediaRecord = CreateExerciseMediaInput & {
  exerciseId: string;
  createdByUserId: string | null;
};

@Injectable()
export class ExerciseMediaRepository {
  constructor(
    @InjectModel(ExerciseMediaModel)
    private readonly mediaModel: typeof ExerciseMediaModel,
    private readonly sequelize: Sequelize,
  ) {}

  listActiveByExercise(exerciseId: string): Promise<ExerciseMediaModel[]> {
    return this.mediaModel.findAll({
      where: { exerciseId, status: ExerciseMediaStatus.ACTIVE },
      order: [
        ['isPrimary', 'DESC'],
        ['sortOrder', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });
  }

  countActiveByExercise(exerciseId: string): Promise<number> {
    return this.mediaModel.count({
      where: { exerciseId, status: ExerciseMediaStatus.ACTIVE },
    });
  }

  /**
   * Busca por la identidad única (ejercicio, proveedor, identificador externo),
   * en cualquier estado. Es lo que permite que volver a subir el mismo archivo
   * reutilice la fila en vez de chocar contra `uq_exercise_media_external_identity`.
   */
  findByExternalIdentity(
    exerciseId: string,
    provider: string,
    externalId: string,
  ): Promise<ExerciseMediaModel | null> {
    return this.mediaModel.findOne({
      where: { exerciseId, provider, externalId },
    });
  }

  findActiveById(mediaId: string): Promise<ExerciseMediaModel | null> {
    return this.mediaModel.findOne({
      where: { id: mediaId, status: ExerciseMediaStatus.ACTIVE },
      include: [ExerciseModel],
    });
  }

  create(
    input: CreateExerciseMediaRecord,
    transaction?: Transaction,
  ): Promise<ExerciseMediaModel> {
    return this.mediaModel.create(input, { transaction });
  }

  async clearPrimary(
    exerciseId: string,
    transaction?: Transaction,
  ): Promise<void> {
    await this.mediaModel.update(
      { isPrimary: false },
      {
        where: {
          exerciseId,
          status: ExerciseMediaStatus.ACTIVE,
          isPrimary: true,
        },
        transaction,
      },
    );
  }

  /** Every row of an exercise, active or not: what deleting a personal exercise must release. */
  listAllByExercise(exerciseId: string): Promise<ExerciseMediaModel[]> {
    return this.mediaModel.findAll({ where: { exerciseId } });
  }

  /**
   * Under an OPEN report on the exercise its uploads are evidence: instead of
   * being destroyed they are held (`author_deleted_at`, INACTIVE, so no reader
   * serves them) and keep their file. The identity is freed so a re-upload
   * creates a new row and never revives or replaces the held one. Returns
   * false (nothing changed) when no report on the exercise is open.
   */
  async holdIfExerciseReported(
    exerciseId: string,
    mediaIds: readonly string[],
    transaction: Transaction,
  ): Promise<boolean> {
    if (mediaIds.length === 0) return false;
    const [, affected] = await this.sequelize.query(
      `UPDATE training.exercise_media t
          SET author_deleted_at = COALESCE(t.author_deleted_at, now()), status = 'INACTIVE',
              is_primary = false, external_id = NULL, updated_at = now()
        WHERE t.ejercicio_id = :exerciseId AND t.id IN (:mediaIds)
          AND ${hasOpenReportSql('EXERCISE', 't.ejercicio_id')}`,
      { type: QueryTypes.UPDATE, replacements: { exerciseId, mediaIds: [...mediaIds] }, transaction },
    );
    return Number(affected) > 0;
  }

  /** Hard delete: an INACTIVE row would keep its file referenced forever. */
  async destroy(media: ExerciseMediaModel, transaction: Transaction): Promise<void> {
    await media.destroy({ transaction });
  }

  async markInactive(
    media: ExerciseMediaModel,
    transaction?: Transaction,
  ): Promise<void> {
    await media.update(
      {
        status: ExerciseMediaStatus.INACTIVE,
        isPrimary: false,
      },
      { transaction },
    );
  }

  async promoteFirstActive(
    exerciseId: string,
    transaction?: Transaction,
  ): Promise<void> {
    const replacement = await this.mediaModel.findOne({
      where: { exerciseId, status: ExerciseMediaStatus.ACTIVE },
      order: [
        ['sortOrder', 'ASC'],
        ['createdAt', 'ASC'],
      ],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });

    if (replacement) {
      await replacement.update({ isPrimary: true }, { transaction });
    }
  }
}

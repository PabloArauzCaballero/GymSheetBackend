import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { ExerciseMediaStatus } from '../../common/enums/domain.enums';
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

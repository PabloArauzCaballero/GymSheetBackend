import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Includeable, Op, Transaction, WhereOptions } from 'sequelize';
import {
  ExerciseMediaStatus,
  ExerciseStatus,
  ExerciseType,
} from '../../common/enums/domain.enums';
import { EquipmentModel } from '../equipment/equipment.model';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseMediaModel } from './exercise-media.model';
import { ExerciseModel } from './exercise.model';
import {
  CreateGlobalExerciseInput,
  CreatePersonalExerciseInput,
  ExerciseFilterInput,
  UpdateExerciseInput,
} from './exercises.schemas';
import { UserExerciseModel } from './user-exercise.model';

export type ExercisePageResult = {
  rows: ExerciseModel[];
  count: number;
};

@Injectable()
export class ExercisesRepository {
  constructor(
    @InjectModel(ExerciseModel)
    private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(ExerciseEquipmentModel)
    private readonly exerciseEquipmentModel: typeof ExerciseEquipmentModel,
    @InjectModel(UserExerciseModel)
    private readonly userExerciseModel: typeof UserExerciseModel,
  ) {}

  listVisibleForUser(
    userId: string,
    filters: ExerciseFilterInput,
  ): Promise<ExercisePageResult> {
    const where = this.buildVisibilityWhere(userId, filters);
    const offset = (filters.page - 1) * filters.pageSize;

    return this.exerciseModel.findAndCountAll({
      where,
      include: this.buildIncludes(filters.equipmentId, true),
      distinct: true,
      limit: filters.pageSize,
      offset,
      order: [['name', 'ASC']],
    });
  }

  findVisibleById(exerciseId: string, userId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findOne({
      where: {
        id: exerciseId,
        status: ExerciseStatus.ACTIVE,
        [Op.or]: [
          { type: ExerciseType.GLOBAL },
          { type: ExerciseType.PERSONAL, createdByUserId: userId },
        ],
      },
      include: this.buildIncludes(undefined, false),
    });
  }

  findGlobalById(exerciseId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findOne({
      where: {
        id: exerciseId,
        type: ExerciseType.GLOBAL,
        status: ExerciseStatus.ACTIVE,
      },
      include: this.buildIncludes(undefined, false),
    });
  }

  createGlobal(
    input: CreateGlobalExerciseInput,
    transaction?: Transaction,
  ): Promise<ExerciseModel> {
    return this.exerciseModel.create(
      {
        ...this.toExerciseAttributes(input),
        type: ExerciseType.GLOBAL,
        createdByUserId: null,
      },
      { transaction },
    );
  }

  createPersonal(
    userId: string,
    input: CreatePersonalExerciseInput,
    transaction?: Transaction,
  ): Promise<ExerciseModel> {
    return this.exerciseModel.create(
      {
        ...this.toExerciseAttributes(input),
        type: ExerciseType.PERSONAL,
        createdByUserId: userId,
      },
      { transaction },
    );
  }

  async replaceExerciseEquipment(
    exerciseId: string,
    equipmentIds: string[],
    transaction?: Transaction,
  ): Promise<void> {
    await this.exerciseEquipmentModel.destroy({
      where: { exerciseId },
      transaction,
    });

    if (equipmentIds.length === 0) {
      return;
    }

    await this.exerciseEquipmentModel.bulkCreate(
      equipmentIds.map((equipmentId) => ({ exerciseId, equipmentId })),
      { transaction },
    );
  }

  async updateExercise(
    exercise: ExerciseModel,
    input: UpdateExerciseInput,
    transaction?: Transaction,
  ): Promise<ExerciseModel> {
    const { equipmentIds: _equipmentIds, ...changes } = input;
    await exercise.update(changes, { transaction });
    return exercise;
  }

  async markInactive(exercise: ExerciseModel): Promise<ExerciseModel> {
    await exercise.update({ status: ExerciseStatus.INACTIVE });
    return exercise;
  }

  findFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel | null> {
    return this.userExerciseModel.findOne({ where: { userId, exerciseId } });
  }

  listFavorites(userId: string): Promise<UserExerciseModel[]> {
    return this.userExerciseModel.findAll({
      where: { userId },
      include: [
        {
          model: ExerciseModel,
          required: true,
          where: { status: ExerciseStatus.ACTIVE },
          include: this.buildIncludes(undefined, true),
        },
      ],
      order: [['selectedAt', 'DESC']],
    });
  }

  createFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel> {
    return this.userExerciseModel.create({ userId, exerciseId });
  }

  deleteFavorite(userId: string, exerciseId: string): Promise<number> {
    return this.userExerciseModel.destroy({ where: { userId, exerciseId } });
  }

  private buildVisibilityWhere(
    userId: string,
    filters: ExerciseFilterInput,
  ): WhereOptions {
    const conditions: WhereOptions[] = [
      {
        [Op.or]: [
          { type: ExerciseType.GLOBAL },
          { type: ExerciseType.PERSONAL, createdByUserId: userId },
        ],
      },
    ];

    if (filters.search) {
      conditions.push({
        [Op.or]: [
          { name: { [Op.iLike]: `%${filters.search}%` } },
          { description: { [Op.iLike]: `%${filters.search}%` } },
        ],
      });
    }

    return {
      status: ExerciseStatus.ACTIVE,
      ...(filters.muscleGroup ? { muscleGroup: filters.muscleGroup } : {}),
      ...(filters.bodyPart ? { bodyPart: filters.bodyPart } : {}),
      ...(filters.targetMuscle ? { targetMuscle: filters.targetMuscle } : {}),
      ...(filters.dataSource ? { dataSource: filters.dataSource } : {}),
      [Op.and]: conditions,
    };
  }

  private buildIncludes(
    equipmentId: string | undefined,
    primaryMediaOnly: boolean,
  ): Includeable[] {
    return [
      {
        model: ExerciseEquipmentModel,
        required: Boolean(equipmentId),
        where: equipmentId ? { equipmentId } : undefined,
        include: [{ model: EquipmentModel, required: false }],
      },
      {
        model: ExerciseMediaModel,
        required: false,
        separate: true,
        where: {
          status: ExerciseMediaStatus.ACTIVE,
          ...(primaryMediaOnly ? { isPrimary: true } : {}),
        },
        order: [
          ['isPrimary', 'DESC'],
          ['sortOrder', 'ASC'],
        ],
      },
    ];
  }

  private toExerciseAttributes(
    input: CreateGlobalExerciseInput,
  ): Omit<CreateGlobalExerciseInput, 'equipmentIds'> {
    const { equipmentIds: _equipmentIds, ...attributes } = input;
    return attributes;
  }
}

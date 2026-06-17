import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, WhereOptions } from 'sequelize';
import { ExerciseStatus, ExerciseType } from '../../common/enums/domain.enums';
import { EquipmentModel } from '../equipment/equipment.model';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseModel } from './exercise.model';
import { UserExerciseModel } from './user-exercise.model';
import { CreateGlobalExerciseInput, CreatePersonalExerciseInput, ExerciseFilterInput, UpdateExerciseInput } from './exercises.schemas';

@Injectable()
export class ExercisesRepository {
  constructor(
    @InjectModel(ExerciseModel) private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(ExerciseEquipmentModel) private readonly exerciseEquipmentModel: typeof ExerciseEquipmentModel,
    @InjectModel(UserExerciseModel) private readonly userExerciseModel: typeof UserExerciseModel,
  ) {}

  listVisibleForUser(userId: string, filters: ExerciseFilterInput): Promise<ExerciseModel[]> {
    const where: WhereOptions = {
      estado: ExerciseStatus.ACTIVO,
      [Op.or]: [
        { tipoEjercicio: ExerciseType.GLOBAL },
        { tipoEjercicio: ExerciseType.PERSONAL, createdByUsuarioId: userId },
      ],
    };

    if (filters.grupoMuscular) {
      where.grupoMuscular = filters.grupoMuscular;
    }

    return this.exerciseModel.findAll({
      where,
      include: [
        {
          model: ExerciseEquipmentModel,
          required: Boolean(filters.equipoId),
          where: filters.equipoId ? { equipoGymId: filters.equipoId } : undefined,
          include: [EquipmentModel],
        },
      ],
      order: [['nombre', 'ASC']],
    });
  }

  findVisibleById(id: string, userId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findOne({
      where: {
        id,
        estado: ExerciseStatus.ACTIVO,
        [Op.or]: [
          { tipoEjercicio: ExerciseType.GLOBAL },
          { tipoEjercicio: ExerciseType.PERSONAL, createdByUsuarioId: userId },
        ],
      },
      include: [{ model: ExerciseEquipmentModel, include: [EquipmentModel] }],
    });
  }

  createGlobal(input: CreateGlobalExerciseInput, transaction?: Transaction): Promise<ExerciseModel> {
    return this.exerciseModel.create(
      {
        nombre: input.nombre,
        grupoMuscular: input.grupoMuscular,
        descripcion: input.descripcion ?? null,
        tipoEjercicio: ExerciseType.GLOBAL,
        createdByUsuarioId: null,
      },
      { transaction },
    );
  }

  createPersonal(userId: string, input: CreatePersonalExerciseInput, transaction?: Transaction): Promise<ExerciseModel> {
    return this.exerciseModel.create(
      {
        nombre: input.nombre,
        grupoMuscular: input.grupoMuscular,
        descripcion: input.descripcion ?? null,
        tipoEjercicio: ExerciseType.PERSONAL,
        createdByUsuarioId: userId,
      },
      { transaction },
    );
  }

  async replaceExerciseEquipment(ejercicioId: string, equipoIds: string[], transaction?: Transaction): Promise<void> {
    await this.exerciseEquipmentModel.destroy({ where: { ejercicioId }, transaction });
    if (equipoIds.length === 0) return;

    await this.exerciseEquipmentModel.bulkCreate(
      equipoIds.map((equipoGymId) => ({ ejercicioId, equipoGymId })),
      { transaction },
    );
  }

  async updateExercise(exercise: ExerciseModel, input: UpdateExerciseInput, transaction?: Transaction): Promise<ExerciseModel> {
    await exercise.update(
      {
        nombre: input.nombre ?? exercise.nombre,
        grupoMuscular: input.grupoMuscular ?? exercise.grupoMuscular,
        descripcion: input.descripcion === undefined ? exercise.descripcion : input.descripcion,
      },
      { transaction },
    );
    return exercise;
  }

  async markInactive(exercise: ExerciseModel): Promise<ExerciseModel> {
    await exercise.update({ estado: ExerciseStatus.INACTIVO });
    return exercise;
  }

  findFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel | null> {
    return this.userExerciseModel.findOne({ where: { usuarioId: userId, ejercicioId: exerciseId } });
  }

  listFavorites(userId: string): Promise<UserExerciseModel[]> {
    return this.userExerciseModel.findAll({
      where: { usuarioId: userId },
      include: [ExerciseModel],
      order: [['fechaSeleccion', 'DESC']],
    });
  }

  createFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel> {
    return this.userExerciseModel.create({ usuarioId: userId, ejercicioId: exerciseId });
  }

  async deleteFavorite(userId: string, exerciseId: string): Promise<number> {
    return this.userExerciseModel.destroy({ where: { usuarioId: userId, ejercicioId: exerciseId } });
  }
}

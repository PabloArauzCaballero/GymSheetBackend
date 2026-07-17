import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ExerciseType } from '../../common/enums/domain.enums';
import { EquipmentRepository } from '../equipment/equipment.repository';
import {
  ExercisePageResponse,
  ExerciseResponse,
  FavoriteExerciseResponse,
  mapExerciseToResponse,
  mapFavoriteToResponse,
} from './exercise.mapper';
import { ExerciseModel } from './exercise.model';
import { ExercisesRepository } from './exercises.repository';
import {
  CreateGlobalExerciseInput,
  CreatePersonalExerciseInput,
  ExerciseFilterInput,
  UpdateExerciseInput,
} from './exercises.schemas';

export type FavoriteMutationResponse = {
  id: string;
  ejercicioId: string;
  fechaSeleccion: Date;
};

@Injectable()
export class ExercisesService {
  constructor(
    private readonly exercisesRepository: ExercisesRepository,
    private readonly equipmentRepository: EquipmentRepository,
    private readonly sequelize: Sequelize,
  ) {}

  async listVisibleForUser(
    userId: string,
    filters: ExerciseFilterInput,
  ): Promise<ExercisePageResponse> {
    const result = await this.exercisesRepository.listVisibleForUser(userId, filters);

    return {
      items: result.rows.map(mapExerciseToResponse),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / filters.pageSize),
    };
  }

  async getVisibleExerciseOrFail(
    exerciseId: string,
    userId: string,
  ): Promise<ExerciseResponse> {
    const exercise = await this.findVisibleExerciseModelOrFail(exerciseId, userId);
    return mapExerciseToResponse(exercise);
  }

  async createGlobalExercise(input: CreateGlobalExerciseInput): Promise<ExerciseResponse> {
    const equipmentIds = await this.validateEquipmentIds(input.equipmentIds);
    const exerciseId = await this.sequelize.transaction(async (transaction) => {
      const exercise = await this.exercisesRepository.createGlobal(input, transaction);
      await this.exercisesRepository.replaceExerciseEquipment(
        exercise.id,
        equipmentIds,
        transaction,
      );
      return exercise.id;
    });

    const exercise = await this.exercisesRepository.findGlobalById(exerciseId);
    return mapExerciseToResponse(this.requireExercise(exercise));
  }

  async createPersonalExercise(
    userId: string,
    input: CreatePersonalExerciseInput,
  ): Promise<ExerciseResponse> {
    const equipmentIds = await this.validateEquipmentIds(input.equipmentIds);
    const exerciseId = await this.sequelize.transaction(async (transaction) => {
      const exercise = await this.exercisesRepository.createPersonal(
        userId,
        input,
        transaction,
      );
      await this.exercisesRepository.replaceExerciseEquipment(
        exercise.id,
        equipmentIds,
        transaction,
      );
      return exercise.id;
    });

    return this.getVisibleExerciseOrFail(exerciseId, userId);
  }

  async updatePersonalExercise(
    userId: string,
    exerciseId: string,
    input: UpdateExerciseInput,
  ): Promise<ExerciseResponse> {
    const exercise = await this.findPersonalOwnedExerciseOrFail(userId, exerciseId);
    const equipmentIds =
      input.equipmentIds === undefined
        ? undefined
        : await this.validateEquipmentIds(input.equipmentIds);

    await this.sequelize.transaction(async (transaction) => {
      await this.exercisesRepository.updateExercise(exercise, input, transaction);

      if (equipmentIds !== undefined) {
        await this.exercisesRepository.replaceExerciseEquipment(
          exercise.id,
          equipmentIds,
          transaction,
        );
      }
    });

    return this.getVisibleExerciseOrFail(exerciseId, userId);
  }

  async updateGlobalExercise(
    exerciseId: string,
    input: UpdateExerciseInput,
  ): Promise<ExerciseResponse> {
    const exercise = await this.findGlobalExerciseOrFail(exerciseId);
    const equipmentIds =
      input.equipmentIds === undefined
        ? undefined
        : await this.validateEquipmentIds(input.equipmentIds);

    await this.sequelize.transaction(async (transaction) => {
      await this.exercisesRepository.updateExercise(exercise, input, transaction);

      if (equipmentIds !== undefined) {
        await this.exercisesRepository.replaceExerciseEquipment(
          exercise.id,
          equipmentIds,
          transaction,
        );
      }
    });

    const updatedExercise = await this.exercisesRepository.findGlobalById(exerciseId);
    return mapExerciseToResponse(this.requireExercise(updatedExercise));
  }

  async inactivatePersonalExercise(
    userId: string,
    exerciseId: string,
  ): Promise<ExerciseResponse> {
    const exercise = await this.findPersonalOwnedExerciseOrFail(userId, exerciseId);
    const inactiveExercise = await this.exercisesRepository.markInactive(exercise);
    return mapExerciseToResponse(inactiveExercise);
  }

  async inactivateGlobalExercise(exerciseId: string): Promise<ExerciseResponse> {
    const exercise = await this.findGlobalExerciseOrFail(exerciseId);
    const inactiveExercise = await this.exercisesRepository.markInactive(exercise);
    return mapExerciseToResponse(inactiveExercise);
  }

  async listFavorites(userId: string): Promise<FavoriteExerciseResponse[]> {
    const favorites = await this.exercisesRepository.listFavorites(userId);
    return favorites.map(mapFavoriteToResponse);
  }

  async addFavorite(
    userId: string,
    exerciseId: string,
  ): Promise<FavoriteMutationResponse> {
    await this.findVisibleExerciseModelOrFail(exerciseId, userId);

    try {
      const favorite = await this.exercisesRepository.createFavorite(userId, exerciseId);
      return {
        id: favorite.id,
        ejercicioId: favorite.exerciseId,
        fechaSeleccion: favorite.selectedAt,
      };
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('El ejercicio ya está seleccionado como frecuente.');
      }
      throw error;
    }
  }

  async removeFavorite(userId: string, exerciseId: string): Promise<{ deleted: true }> {
    const deletedRows = await this.exercisesRepository.deleteFavorite(userId, exerciseId);

    if (deletedRows === 0) {
      throw new NotFoundException('Ejercicio frecuente no encontrado.');
    }

    return { deleted: true };
  }

  private async findVisibleExerciseModelOrFail(
    exerciseId: string,
    userId: string,
  ): Promise<ExerciseModel> {
    const exercise = await this.exercisesRepository.findVisibleById(exerciseId, userId);

    if (!exercise) {
      throw new NotFoundException('Ejercicio no encontrado o no visible para el usuario.');
    }

    return exercise;
  }

  private async findPersonalOwnedExerciseOrFail(
    userId: string,
    exerciseId: string,
  ): Promise<ExerciseModel> {
    const exercise = await this.findVisibleExerciseModelOrFail(exerciseId, userId);

    if (exercise.type !== ExerciseType.PERSONAL || exercise.createdByUserId !== userId) {
      throw new ForbiddenException('Solo puedes modificar tus ejercicios personales.');
    }

    return exercise;
  }

  private async findGlobalExerciseOrFail(exerciseId: string): Promise<ExerciseModel> {
    const exercise = await this.exercisesRepository.findGlobalById(exerciseId);

    if (!exercise) {
      throw new NotFoundException('Ejercicio global no encontrado.');
    }

    return exercise;
  }

  private async validateEquipmentIds(equipmentIds: string[]): Promise<string[]> {
    const uniqueEquipmentIds = [...new Set(equipmentIds)];
    const linkableIds = await this.equipmentRepository.findLinkableIds(uniqueEquipmentIds);

    if (linkableIds.length !== uniqueEquipmentIds.length) {
      throw new BadRequestException(
        'Uno o más equipos no existen o están inactivos.',
      );
    }

    return uniqueEquipmentIds;
  }

  private requireExercise(exercise: ExerciseModel | null): ExerciseModel {
    if (!exercise) {
      throw new NotFoundException('Ejercicio no encontrado.');
    }

    return exercise;
  }
}

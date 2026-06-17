import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { ExerciseType } from '../../common/enums/domain.enums';
import { ExercisesRepository } from './exercises.repository';
import { CreateGlobalExerciseInput, CreatePersonalExerciseInput, ExerciseFilterInput, UpdateExerciseInput } from './exercises.schemas';

@Injectable()
export class ExercisesService {
  constructor(
    private readonly exercisesRepository: ExercisesRepository,
    private readonly sequelize: Sequelize,
  ) {}

  listVisibleForUser(userId: string, filters: ExerciseFilterInput) {
    return this.exercisesRepository.listVisibleForUser(userId, filters);
  }

  async getVisibleExerciseOrFail(exerciseId: string, userId: string) {
    const exercise = await this.exercisesRepository.findVisibleById(exerciseId, userId);

    if (!exercise) {
      throw new NotFoundException('Ejercicio no encontrado o no visible para el usuario.');
    }

    return exercise;
  }

  async createGlobalExercise(input: CreateGlobalExerciseInput) {
    return this.sequelize.transaction(async (transaction) => {
      const exercise = await this.exercisesRepository.createGlobal(input, transaction);
      await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds ?? [], transaction);
      return this.exercisesRepository.findVisibleById(exercise.id, '00000000-0000-0000-0000-000000000000');
    });
  }

  async createPersonalExercise(userId: string, input: CreatePersonalExerciseInput) {
    return this.sequelize.transaction(async (transaction) => {
      const exercise = await this.exercisesRepository.createPersonal(userId, input, transaction);
      await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds ?? [], transaction);
      return this.exercisesRepository.findVisibleById(exercise.id, userId);
    });
  }

  async updatePersonalExercise(userId: string, exerciseId: string, input: UpdateExerciseInput) {
    const exercise = await this.getVisibleExerciseOrFail(exerciseId, userId);

    if (exercise.tipoEjercicio !== ExerciseType.PERSONAL || exercise.createdByUsuarioId !== userId) {
      throw new ForbiddenException('Solo puedes editar tus ejercicios personales.');
    }

    return this.sequelize.transaction(async (transaction) => {
      await this.exercisesRepository.updateExercise(exercise, input, transaction);
      if (input.equipoIds) {
        await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds, transaction);
      }
      return this.exercisesRepository.findVisibleById(exercise.id, userId);
    });
  }

  async updateGlobalExercise(exerciseId: string, input: UpdateExerciseInput) {
    const exercise = await this.getVisibleExerciseOrFail(exerciseId, '00000000-0000-0000-0000-000000000000');

    if (exercise.tipoEjercicio !== ExerciseType.GLOBAL) {
      throw new ForbiddenException('Este endpoint solo modifica ejercicios globales.');
    }

    return this.sequelize.transaction(async (transaction) => {
      await this.exercisesRepository.updateExercise(exercise, input, transaction);
      if (input.equipoIds) {
        await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds, transaction);
      }
      return this.exercisesRepository.findVisibleById(exercise.id, '00000000-0000-0000-0000-000000000000');
    });
  }

  async inactivatePersonalExercise(userId: string, exerciseId: string) {
    const exercise = await this.getVisibleExerciseOrFail(exerciseId, userId);

    if (exercise.tipoEjercicio !== ExerciseType.PERSONAL || exercise.createdByUsuarioId !== userId) {
      throw new ForbiddenException('Solo puedes inhabilitar tus ejercicios personales.');
    }

    return this.exercisesRepository.markInactive(exercise);
  }

  async inactivateGlobalExercise(exerciseId: string) {
    const exercise = await this.getVisibleExerciseOrFail(exerciseId, '00000000-0000-0000-0000-000000000000');
    return this.exercisesRepository.markInactive(exercise);
  }

  listFavorites(userId: string) {
    return this.exercisesRepository.listFavorites(userId);
  }

  async addFavorite(userId: string, exerciseId: string) {
    await this.getVisibleExerciseOrFail(exerciseId, userId);
    const existingFavorite = await this.exercisesRepository.findFavorite(userId, exerciseId);

    if (existingFavorite) {
      throw new ConflictException('El ejercicio ya está seleccionado como frecuente.');
    }

    return this.exercisesRepository.createFavorite(userId, exerciseId);
  }

  async removeFavorite(userId: string, exerciseId: string) {
    const deletedRows = await this.exercisesRepository.deleteFavorite(userId, exerciseId);

    if (deletedRows === 0) {
      throw new NotFoundException('Ejercicio frecuente no encontrado.');
    }

    return { deleted: true };
  }
}

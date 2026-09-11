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
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { EquipmentRepository } from '../equipment/equipment.repository';
import {
  EquipmentInferenceService,
  MuscleEquipmentInference,
} from './equipment-inference.service';
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

/**
 * Alta ya resuelta contra la taxonomía, lista para persistir.
 *
 * `requiredEquipment` no está en el contrato de entrada porque no lo escribe
 * nadie: lo pone el servidor a partir del músculo.
 */
type ResolvedExerciseInput = CreateGlobalExerciseInput & {
  requiredEquipment?: string | null;
};

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
    private readonly equipmentInference: EquipmentInferenceService,
    private readonly sequelize: Sequelize,
  ) {}

  /** Qué máquina corresponde a un músculo, según el catálogo. */
  getEquipmentSuggestion(muscleCode: string): Promise<MuscleEquipmentInference> {
    return this.equipmentInference.inferForMuscle(muscleCode);
  }

  /**
   * Agrupa la taxonomía plana del repositorio en el árbol que la navegación
   * necesita: partes del cuerpo, y dentro de cada una sus músculos objetivo.
   */
  async listTaxonomy() {
    const [rows, images] = await Promise.all([
      this.exercisesRepository.listTaxonomy(),
      this.exercisesRepository.listTaxonomyImages(),
    ]);
    const imageByMuscle = new Map(
      images.map((row) => [`${row.bodyPart}|${row.targetMuscle}`, row.imageUrl]),
    );

    type Muscle = {
      targetMuscle: string;
      total: number;
      imageUrl: string | null;
    };
    type Group = {
      bodyPart: string;
      total: number;
      imageUrl: string | null;
      muscles: Muscle[];
    };
    const byBodyPart = new Map<string, Group>();
    for (const row of rows) {
      const entry = byBodyPart.get(row.bodyPart) ?? {
        bodyPart: row.bodyPart,
        total: 0,
        imageUrl: null,
        muscles: [],
      };
      const imageUrl =
        imageByMuscle.get(`${row.bodyPart}|${row.targetMuscle}`) ?? null;
      entry.total += row.total;
      entry.muscles.push({
        targetMuscle: row.targetMuscle,
        total: row.total,
        imageUrl,
      });
      // La zona hereda la lámina de su músculo más numeroso: es la que mejor
      // representa lo que el usuario encontrará dentro.
      if (!entry.imageUrl && imageUrl) entry.imageUrl = imageUrl;
      byBodyPart.set(row.bodyPart, entry);
    }

    for (const group of byBodyPart.values()) {
      group.muscles.sort((a, b) => b.total - a.total);
      const richest = group.muscles.find((muscle) => muscle.imageUrl);
      if (richest) group.imageUrl = richest.imageUrl;
    }
    return [...byBodyPart.values()].sort((a, b) => b.total - a.total);
  }

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

  async createGlobalExercise(
    actor: AuthenticatedUser,
    input: CreateGlobalExerciseInput,
  ): Promise<ExerciseResponse> {
    const equipmentIds = await this.validateEquipmentIds(
      input.equipmentIds,
      actor.tenantScope,
    );
    let exerciseId: string;
    try {
      exerciseId = await this.sequelize.transaction(async (transaction) => {
        const exercise = await this.exercisesRepository.createGlobal(input, transaction);
        await this.exercisesRepository.replaceExerciseEquipment(
          exercise.id,
          equipmentIds,
          transaction,
        );
        return exercise.id;
      });
    } catch (error) {
      // El catálogo compartido no admite dos ejercicios con el mismo nombre: la
      // unicidad la impone un índice parcial, así que dos altas simultáneas
      // llegan aquí en vez de colarse. Sin esta traducción el alta repetida
      // respondía 500, y cualquier siembra reejecutada duplicaba el catálogo.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('Ya existe un ejercicio con ese nombre en el catálogo.');
      }
      throw error;
    }

    const exercise = await this.exercisesRepository.findGlobalById(exerciseId);
    return mapExerciseToResponse(this.requireExercise(exercise));
  }

  /**
   * Crea un ejercicio propio.
   *
   * Si el alta llega con un músculo, la máquina se deduce del catálogo y el
   * grupo muscular se toma de la taxonomía: la persona solo elige qué quiere
   * entrenar. Si llega con el grupo escrito a mano —la forma anterior— se
   * respeta tal cual y no se deduce nada.
   */
  async createPersonalExercise(
    actor: AuthenticatedUser,
    input: CreatePersonalExerciseInput,
  ): Promise<ExerciseResponse> {
    const resolved = await this.resolveMuscleDrivenInput(input);
    const userId = actor.id;
    // Un ejercicio personal solo puede apuntar al equipo del gimnasio del socio.
    const equipmentIds = await this.validateEquipmentIds(
      resolved.equipmentIds,
      actor.tenantId,
    );
    const exerciseId = await this.sequelize.transaction(async (transaction) => {
      const exercise = await this.exercisesRepository.createPersonal(
        userId,
        resolved,
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
    actor: AuthenticatedUser,
    exerciseId: string,
    input: UpdateExerciseInput,
  ): Promise<ExerciseResponse> {
    const userId = actor.id;
    const exercise = await this.findPersonalOwnedExerciseOrFail(userId, exerciseId);
    const equipmentIds =
      input.equipmentIds === undefined
        ? undefined
        : await this.validateEquipmentIds(input.equipmentIds, actor.tenantId);

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
    actor: AuthenticatedUser,
    exerciseId: string,
    input: UpdateExerciseInput,
  ): Promise<ExerciseResponse> {
    const exercise = await this.findGlobalExerciseOrFail(exerciseId);
    const equipmentIds =
      input.equipmentIds === undefined
        ? undefined
        : await this.validateEquipmentIds(input.equipmentIds, actor.tenantScope);

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

  /**
   * Convierte el alta guiada por músculo en la forma que espera el modelo.
   *
   * Lo que la persona no declara se toma del catálogo, no de un valor por
   * defecto inventado: el grupo muscular sale de la taxonomía y el equipamiento
   * de lo que de verdad se usa para ese músculo en los ejercicios existentes.
   * Lo que la persona sí declara nunca se pisa.
   */
  private async resolveMuscleDrivenInput(
    input: CreatePersonalExerciseInput,
  ): Promise<ResolvedExerciseInput> {
    const { muscleCode, equipmentLabel, muscleGroup, ...rest } = input;

    if (!muscleCode) {
      if (!muscleGroup) {
        throw new BadRequestException(
          'Indica el músculo entrenado o el grupo muscular.',
        );
      }
      return { ...rest, muscleGroup };
    }

    const inference = await this.equipmentInference.inferForMuscle(muscleCode);
    const chosen =
      (equipmentLabel
        ? [inference.primary, ...inference.alternatives].find(
            (option) => option?.label === equipmentLabel.toLowerCase(),
          )
        : inference.primary) ?? inference.primary;

    return {
      ...rest,
      muscleGroup: muscleGroup ?? inference.muscleGroupName,
      targetMuscle: rest.targetMuscle ?? inference.muscleName,
      bodyPart: rest.bodyPart ?? inference.muscleGroupName,
      // Columna real del catálogo: así el ejercicio propio se filtra y se
      // compara con los globales por el mismo campo, en vez de quedar aparte.
      requiredEquipment: chosen?.label ?? null,
      metadata: {
        ...rest.metadata,
        // Procedencia: permite revisar por qué salió esa máquina y recalcularla
        // si el catálogo cambia, sin tener que adivinarlo desde la etiqueta.
        muscleCode: inference.muscleCode,
        equipmentName: chosen?.name ?? null,
        equipmentType: chosen?.type ?? null,
        equipmentInferredFromCatalogue: equipmentLabel === null,
      },
    };
  }

  /**
   * El alcance llega hasta aqui porque enlazar es una forma de leer: sin el,
   * un ejercicio podia quedar apuntando al equipo de otro gimnasio, y la
   * respuesta de validacion confirmaba de paso que ese identificador existia.
   */
  private async validateEquipmentIds(
    equipmentIds: string[],
    tenantScope: string | null,
  ): Promise<string[]> {
    const uniqueEquipmentIds = [...new Set(equipmentIds)];
    const linkableIds = await this.equipmentRepository.findLinkableIds(
      uniqueEquipmentIds,
      tenantScope,
    );

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

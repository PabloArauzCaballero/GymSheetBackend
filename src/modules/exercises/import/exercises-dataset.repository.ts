import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import {
  ExerciseDataSource,
  ExerciseMediaProvider,
  ExerciseMediaStatus,
  ExerciseMediaType,
  ExerciseStatus,
  ExerciseType,
} from '../../../common/enums/domain.enums';
import { ExerciseMediaModel } from '../exercise-media.model';
import { ExerciseModel } from '../exercise.model';
import { ExternalExercise } from './exercises-dataset.schemas';

export type ExternalExerciseImportContext = {
  sourceUrl: string;
  sourceVersion: string;
  contentSha256: string;
  fetchedAt: Date;
  mediaBaseUrl: string;
  importMedia: boolean;
};

export type UpsertExerciseResult = {
  exerciseId: string;
  created: boolean;
  mediaCreated: number;
  mediaUpdated: number;
};

@Injectable()
export class ExercisesDatasetRepository {
  constructor(
    @InjectModel(ExerciseModel)
    private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(ExerciseMediaModel)
    private readonly mediaModel: typeof ExerciseMediaModel,
  ) {}

  /**
   * Creates or updates one external exercise using its stable source identity.
   * `findOrCreate` uses a savepoint inside the caller transaction and safely
   * recovers when another importer inserts the same unique identity first.
   */
  async upsertExercise(
    record: ExternalExercise,
    context: ExternalExerciseImportContext,
    transaction: Transaction,
  ): Promise<UpsertExerciseResult> {
    const exerciseAttributes = this.toExerciseAttributes(record, context);
    const [exercise, created] = await this.exerciseModel.findOrCreate({
      where: {
        dataSource: ExerciseDataSource.EXERCISES_DATASET,
        externalId: record.id,
      },
      defaults: exerciseAttributes,
      transaction,
    });

    if (!created) {
      await exercise.update(exerciseAttributes, { transaction });
    }

    let mediaCreated = 0;
    let mediaUpdated = 0;

    if (context.importMedia) {
      const imageResult = await this.upsertMedia(
        exercise.id,
        record,
        context,
        ExerciseMediaType.IMAGE,
        record.image,
        true,
        transaction,
      );
      const gifResult = await this.upsertMedia(
        exercise.id,
        record,
        context,
        ExerciseMediaType.GIF,
        record.gif_url,
        false,
        transaction,
      );
      mediaCreated = Number(imageResult.created) + Number(gifResult.created);
      mediaUpdated = Number(!imageResult.created) + Number(!gifResult.created);
    }

    return {
      exerciseId: exercise.id,
      created,
      mediaCreated,
      mediaUpdated,
    };
  }

  private toExerciseAttributes(
    record: ExternalExercise,
    context: ExternalExerciseImportContext,
  ): Record<string, unknown> {
    return {
      name: record.name,
      muscleGroup: record.muscle_group,
      description: record.instructions.es ?? record.instructions.en ?? null,
      type: ExerciseType.GLOBAL,
      createdByUserId: null,
      status: ExerciseStatus.ACTIVE,
      dataSource: ExerciseDataSource.EXERCISES_DATASET,
      externalId: record.id,
      externalVersion: context.sourceVersion,
      sourceUrl: context.sourceUrl,
      sourceLicense: 'MIT data; media governed by separate Gym Visual terms',
      sourceAttribution: record.attribution,
      category: record.category,
      bodyPart: record.body_part,
      requiredEquipment: record.equipment,
      targetMuscle: record.target,
      synergistMuscleGroup: record.muscle_group,
      secondaryMuscles: record.secondary_muscles,
      instructions: record.instructions,
      instructionSteps: record.instruction_steps,
      metadata: {
        datasetCreatedAt: record.created_at,
        mediaId: record.media_id,
        contentSha256: context.contentSha256,
      },
      importedAt: context.fetchedAt,
    };
  }

  private async upsertMedia(
    exerciseId: string,
    record: ExternalExercise,
    context: ExternalExerciseImportContext,
    mediaType: ExerciseMediaType,
    relativePath: string,
    isPrimary: boolean,
    transaction: Transaction,
  ): Promise<{ created: boolean }> {
    const externalId = `${record.id}:${mediaType.toLowerCase()}`;
    const absoluteUrl = new URL(relativePath, context.mediaBaseUrl).toString();
    const mediaAttributes = {
      exerciseId,
      mediaType,
      provider: ExerciseMediaProvider.EXTERNAL_URL,
      externalId,
      url: absoluteUrl,
      thumbnailUrl:
        mediaType === ExerciseMediaType.GIF
          ? new URL(record.image, context.mediaBaseUrl).toString()
          : null,
      mimeType: mediaType === ExerciseMediaType.GIF ? 'image/gif' : 'image/jpeg',
      width: 180,
      height: 180,
      checksumSha256: null,
      altText: `${record.name} exercise demonstration`,
      attribution: record.attribution,
      license: 'Gym Visual media terms; permission must be confirmed by deployer',
      isPrimary,
      sortOrder: isPrimary ? 0 : 1,
      status: ExerciseMediaStatus.ACTIVE,
      metadata: {
        sourcePath: relativePath,
        datasetMediaId: record.media_id,
        sourceVersion: context.sourceVersion,
      },
      createdByUserId: null,
    };
    const [media, created] = await this.mediaModel.findOrCreate({
      where: {
        exerciseId,
        provider: ExerciseMediaProvider.EXTERNAL_URL,
        externalId,
      },
      defaults: mediaAttributes,
      transaction,
    });

    if (!created) {
      await media.update(mediaAttributes, { transaction });
    }

    return { created };
  }
}

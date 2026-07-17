import {
  ExerciseDataSource,
  ExerciseMediaProvider,
  ExerciseMediaStatus,
  ExerciseMediaType,
  ExerciseStatus,
  ExerciseType,
} from '../../common/enums/domain.enums';
import { EquipmentResponse, mapEquipmentToResponse } from '../equipment/equipment.mapper';
import { ExerciseMediaModel } from './exercise-media.model';
import {
  ExerciseModel,
  LocalizedInstructions,
  LocalizedInstructionSteps,
} from './exercise.model';
import { UserExerciseModel } from './user-exercise.model';

export type ExerciseMediaResponse = {
  id: string;
  mediaType: ExerciseMediaType;
  provider: ExerciseMediaProvider;
  externalId: string | null;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  altText: string;
  attribution: string | null;
  license: string | null;
  isPrimary: boolean;
  sortOrder: number;
  status: ExerciseMediaStatus;
  metadata: Record<string, unknown>;
};

export type ExerciseResponse = {
  id: string;
  nombre: string;
  grupoMuscular: string;
  descripcion: string | null;
  tipoEjercicio: ExerciseType;
  createdByUsuarioId: string | null;
  estado: ExerciseStatus;
  dataSource: ExerciseDataSource;
  externalId: string | null;
  externalVersion: string | null;
  sourceUrl: string | null;
  sourceLicense: string | null;
  sourceAttribution: string | null;
  bodyPart: string | null;
  targetMuscle: string | null;
  synergistMuscleGroup: string | null;
  secondaryMuscles: string[];
  instructions: LocalizedInstructions;
  instructionSteps: LocalizedInstructionSteps;
  metadata: Record<string, unknown>;
  equipment: EquipmentResponse[];
  media: ExerciseMediaResponse[];
};

export type ExercisePageResponse = {
  items: ExerciseResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type FavoriteExerciseResponse = {
  id: string;
  fechaSeleccion: Date;
  ejercicio: ExerciseResponse;
};

export function mapExerciseMediaToResponse(media: ExerciseMediaModel): ExerciseMediaResponse {
  return {
    id: media.id,
    mediaType: media.mediaType,
    provider: media.provider,
    externalId: media.externalId,
    url: media.url,
    thumbnailUrl: media.thumbnailUrl,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    checksumSha256: media.checksumSha256,
    altText: media.altText,
    attribution: media.attribution,
    license: media.license,
    isPrimary: media.isPrimary,
    sortOrder: media.sortOrder,
    status: media.status,
    metadata: media.metadata,
  };
}

export function mapExerciseToResponse(exercise: ExerciseModel): ExerciseResponse {
  const equipment = (exercise.equipmentLinks ?? [])
    .map((link) => link.equipment)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map(mapEquipmentToResponse);

  return {
    id: exercise.id,
    nombre: exercise.name,
    grupoMuscular: exercise.muscleGroup,
    descripcion: exercise.description,
    tipoEjercicio: exercise.type,
    createdByUsuarioId: exercise.createdByUserId,
    estado: exercise.status,
    dataSource: exercise.dataSource,
    externalId: exercise.externalId,
    externalVersion: exercise.externalVersion,
    sourceUrl: exercise.sourceUrl,
    sourceLicense: exercise.sourceLicense,
    sourceAttribution: exercise.sourceAttribution,
    bodyPart: exercise.bodyPart,
    targetMuscle: exercise.targetMuscle,
    synergistMuscleGroup: exercise.synergistMuscleGroup,
    secondaryMuscles: exercise.secondaryMuscles,
    instructions: exercise.instructions,
    instructionSteps: exercise.instructionSteps,
    metadata: exercise.metadata,
    equipment,
    media: (exercise.media ?? []).map(mapExerciseMediaToResponse),
  };
}

export function mapFavoriteToResponse(favorite: UserExerciseModel): FavoriteExerciseResponse {
  if (!favorite.exercise) {
    throw new Error('Favorite exercise relation was not loaded.');
  }

  return {
    id: favorite.id,
    fechaSeleccion: favorite.selectedAt,
    ejercicio: mapExerciseToResponse(favorite.exercise),
  };
}

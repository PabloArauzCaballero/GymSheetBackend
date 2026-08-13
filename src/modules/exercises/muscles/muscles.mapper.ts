import { ExerciseMuscleModel } from "./exercise-muscle.model";
import { ExerciseRatingModel } from "./exercise-rating.model";
import { MuscleGroupModel } from "./muscle-group.model";
import { MuscleModel } from "./muscle.model";

export function mapMuscle(muscle: MuscleModel) {
  return {
    code: muscle.code,
    nombre: muscle.name,
    nombreLatin: muscle.latinName,
    descripcion: muscle.description,
    grupo: muscle.group
      ? { code: muscle.group.code, nombre: muscle.group.name }
      : undefined,
  };
}

export function mapMuscleGroup(group: MuscleGroupModel) {
  return {
    code: group.code,
    nombre: group.name,
    region: group.region,
    descripcion: group.description,
    musculos: (group.muscles ?? []).map((muscle) => ({
      code: muscle.code,
      nombre: muscle.name,
      nombreLatin: muscle.latinName,
    })),
  };
}

export function mapExerciseRating(rating: ExerciseRatingModel | null) {
  if (!rating) return null;
  return {
    recomendado: rating.recommendedStars,
    diversion: rating.funStars,
    factores: rating.factors,
  };
}

export function mapExerciseMuscles(
  exerciseId: string,
  relations: ExerciseMuscleModel[],
  rating: ExerciseRatingModel | null,
) {
  const byRole = (role: string) =>
    relations
      .filter((relation) => relation.role === role && relation.muscle)
      .map((relation) => mapMuscle(relation.muscle!));
  return {
    ejercicioId: exerciseId,
    primarios: byRole("PRIMARY"),
    secundarios: byRole("SECONDARY"),
    estabilizadores: byRole("STABILIZER"),
    rating: mapExerciseRating(rating),
  };
}

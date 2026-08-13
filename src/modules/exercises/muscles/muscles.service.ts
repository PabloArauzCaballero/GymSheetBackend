import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ExerciseModel } from "../exercise.model";
import { ExerciseMuscleModel } from "./exercise-muscle.model";
import { ExerciseRatingModel } from "./exercise-rating.model";
import { MuscleGroupModel } from "./muscle-group.model";
import { MuscleModel } from "./muscle.model";
import {
  mapExerciseMuscles,
  mapMuscleGroup,
} from "./muscles.mapper";
import { ExercisePreferenceInput } from "./muscles.schemas";
import { UserExercisePreferenceModel } from "./user-exercise-preference.model";

interface GroupExerciseRow {
  id: string;
  name: string;
  recommended_stars: number | null;
  fun_stars: number | null;
}

interface SimilarExerciseRow extends GroupExerciseRow {
  shared: string;
  shared_primary: string;
}

interface MuscleExerciseRow extends GroupExerciseRow {
  role: string;
}

@Injectable()
export class MusclesService {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(MuscleGroupModel)
    private readonly muscleGroupModel: typeof MuscleGroupModel,
    @InjectModel(MuscleModel)
    private readonly muscleModel: typeof MuscleModel,
    @InjectModel(ExerciseModel)
    private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(ExerciseMuscleModel)
    private readonly exerciseMuscleModel: typeof ExerciseMuscleModel,
    @InjectModel(ExerciseRatingModel)
    private readonly exerciseRatingModel: typeof ExerciseRatingModel,
    @InjectModel(UserExercisePreferenceModel)
    private readonly preferenceModel: typeof UserExercisePreferenceModel,
  ) {}

  async listMuscleGroups() {
    const groups = await this.muscleGroupModel.findAll({
      include: [{ model: MuscleModel }],
      order: [
        ["name", "ASC"],
        [{ model: MuscleModel, as: "muscles" }, "name", "ASC"],
      ],
    });
    return groups.map(mapMuscleGroup);
  }

  async getExerciseMuscles(exerciseId: string) {
    const exercise = await this.exerciseModel.findByPk(exerciseId);
    if (!exercise) throw new NotFoundException("Ejercicio no encontrado.");
    const relations = await this.exerciseMuscleModel.findAll({
      where: { exerciseId },
      include: [{ model: MuscleModel, include: [MuscleGroupModel] }],
    });
    const rating = await this.exerciseRatingModel.findByPk(exerciseId);
    return mapExerciseMuscles(exerciseId, relations, rating);
  }

  async listExercisesByGroup(groupCode: string, limit: number) {
    const group = await this.muscleGroupModel.findOne({
      where: { code: groupCode.toUpperCase() },
    });
    if (!group) throw new NotFoundException("Grupo muscular no encontrado.");
    const rows = await this.sequelize.query<GroupExerciseRow>(
      `SELECT e.id, e.nombre AS name, r.recommended_stars, r.fun_stars
       FROM training.exercise_muscles em
       JOIN training.muscles m ON m.id = em.muscle_id
       JOIN public.ejercicios e ON e.id = em.ejercicio_id
       LEFT JOIN training.exercise_ratings r ON r.ejercicio_id = e.id
       WHERE m.muscle_group_id = :groupId AND e.estado = 'ACTIVO'
       GROUP BY e.id, e.nombre, r.recommended_stars, r.fun_stars
       ORDER BY r.recommended_stars DESC NULLS LAST, e.nombre ASC
       LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: { groupId: group.id, limit },
      },
    );
    return {
      grupo: { code: group.code, nombre: group.name },
      total: rows.length,
      ejercicios: rows.map((row) => ({
        id: row.id,
        nombre: row.name,
        recomendado: row.recommended_stars,
        diversion: row.fun_stars,
      })),
    };
  }

  async listMuscles() {
    const rows = await this.muscleModel.findAll({
      include: [{ model: MuscleGroupModel }],
      order: [["name", "ASC"]],
    });
    return rows.map((muscle) => ({
      code: muscle.code,
      nombre: muscle.name,
      nombreLatin: muscle.latinName,
      descripcion: muscle.description,
      grupo: muscle.group
        ? { code: muscle.group.code, nombre: muscle.group.name }
        : undefined,
    }));
  }

  /** Ejercicios que trabajan un músculo específico, primarios primero. */
  async listExercisesByMuscle(muscleCode: string, limit: number) {
    const muscle = await this.muscleModel.findOne({
      where: { code: muscleCode.toUpperCase() },
    });
    if (!muscle) throw new NotFoundException("Músculo no encontrado.");
    const rows = await this.sequelize.query<MuscleExerciseRow>(
      `SELECT e.id, e.nombre AS name, em.role,
              r.recommended_stars, r.fun_stars
       FROM training.exercise_muscles em
       JOIN public.ejercicios e ON e.id = em.ejercicio_id
       LEFT JOIN training.exercise_ratings r ON r.ejercicio_id = e.id
       WHERE em.muscle_id = :muscleId AND e.estado = 'ACTIVO'
       ORDER BY (em.role = 'PRIMARY') DESC, r.recommended_stars DESC NULLS LAST, e.nombre ASC
       LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { muscleId: muscle.id, limit } },
    );
    return {
      musculo: { code: muscle.code, nombre: muscle.name },
      total: rows.length,
      ejercicios: rows.map((row) => ({
        id: row.id,
        nombre: row.name,
        rol: row.role,
        recomendado: row.recommended_stars,
        diversion: row.fun_stars,
      })),
    };
  }

  /** Ejercicios similares por músculos compartidos (primarios pesan más). */
  async findSimilarExercises(exerciseId: string, limit: number) {
    const exercise = await this.exerciseModel.findByPk(exerciseId);
    if (!exercise) throw new NotFoundException("Ejercicio no encontrado.");
    const rows = await this.sequelize.query<SimilarExerciseRow>(
      `SELECT e.id, e.nombre AS name,
              count(*)::text AS shared,
              count(*) FILTER (WHERE em1.role = 'PRIMARY' AND em2.role = 'PRIMARY')::text AS shared_primary,
              r.recommended_stars, r.fun_stars
       FROM training.exercise_muscles em1
       JOIN training.exercise_muscles em2
         ON em2.muscle_id = em1.muscle_id AND em2.ejercicio_id <> em1.ejercicio_id
       JOIN public.ejercicios e ON e.id = em2.ejercicio_id
       LEFT JOIN training.exercise_ratings r ON r.ejercicio_id = e.id
       WHERE em1.ejercicio_id = :exerciseId AND e.estado = 'ACTIVO'
       GROUP BY e.id, e.nombre, r.recommended_stars, r.fun_stars
       ORDER BY shared_primary DESC, shared DESC, r.recommended_stars DESC NULLS LAST
       LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { exerciseId, limit } },
    );
    return {
      ejercicioId: exerciseId,
      total: rows.length,
      similares: rows.map((row) => ({
        id: row.id,
        nombre: row.name,
        musculosCompartidos: Number(row.shared),
        primariosCompartidos: Number(row.shared_primary),
        recomendado: row.recommended_stars,
        diversion: row.fun_stars,
      })),
    };
  }

  async setPreference(
    userId: string,
    exerciseId: string,
    input: ExercisePreferenceInput,
  ) {
    const exercise = await this.exerciseModel.findByPk(exerciseId);
    if (!exercise) throw new NotFoundException("Ejercicio no encontrado.");
    const [preference] = await this.preferenceModel.findOrCreate({
      where: { userId, exerciseId },
      defaults: {
        userId,
        exerciseId,
        isFavorite: input.isFavorite ?? false,
        personalRating: input.personalRating ?? null,
        notes: input.notes ?? null,
      },
    });
    await preference.update({
      isFavorite: input.isFavorite ?? preference.isFavorite,
      personalRating:
        input.personalRating !== undefined
          ? input.personalRating
          : preference.personalRating,
      notes: input.notes !== undefined ? input.notes : preference.notes,
    });
    return {
      ejercicioId: exerciseId,
      favorito: preference.isFavorite,
      valoracionPersonal: preference.personalRating,
      notas: preference.notes,
    };
  }

  async listMyPreferences(userId: string) {
    const rows = await this.preferenceModel.findAll({
      where: { userId },
      order: [["updated_at", "DESC"]],
    });
    return rows.map((preference) => ({
      ejercicioId: preference.exerciseId,
      favorito: preference.isFavorite,
      valoracionPersonal: preference.personalRating,
      notas: preference.notes,
    }));
  }
}

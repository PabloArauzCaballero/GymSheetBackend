import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { computeExerciseRating } from "./exercise-rating";
import { ExerciseMuscleModel } from "./exercise-muscle.model";
import { ExerciseRatingModel } from "./exercise-rating.model";
import { MuscleGroupModel } from "./muscle-group.model";
import { MuscleModel } from "./muscle.model";
import { muscleGroups, muscles, normalizeMuscleLabel } from "./muscle-taxonomy";

interface ExerciseRow {
  id: string;
  grupo_muscular: string | null;
  target_muscle: string | null;
  synergist_muscle_group: string | null;
  secondary_muscles: unknown;
  category: string | null;
  required_equipment: string | null;
}

export interface EnrichmentResult {
  groups: number;
  muscles: number;
  exercises: number;
  exercisesWithMuscles: number;
  exercisesUnmatched: number;
  exerciseMuscleRows: number;
  ratings: number;
}

const CHUNK = 2000;

@Injectable()
export class ExerciseEnrichmentService {
  private readonly logger = new Logger(ExerciseEnrichmentService.name);

  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(MuscleGroupModel)
    private readonly muscleGroupModel: typeof MuscleGroupModel,
    @InjectModel(MuscleModel)
    private readonly muscleModel: typeof MuscleModel,
    @InjectModel(ExerciseMuscleModel)
    private readonly exerciseMuscleModel: typeof ExerciseMuscleModel,
    @InjectModel(ExerciseRatingModel)
    private readonly exerciseRatingModel: typeof ExerciseRatingModel,
  ) {}

  async enrich(): Promise<EnrichmentResult> {
    return this.sequelize.transaction(async (transaction) => {
      // 1) Catálogo de grupos y músculos (idempotente por `code`).
      await this.muscleGroupModel.bulkCreate(
        muscleGroups.map((group) => ({ ...group })),
        {
          updateOnDuplicate: ["name", "region", "description"],
          transaction,
        },
      );
      const groupIdByCode = new Map(
        (await this.muscleGroupModel.findAll({ transaction })).map((group) => [
          group.code,
          group.id,
        ]),
      );
      await this.muscleModel.bulkCreate(
        muscles.map((muscle) => ({
          code: muscle.code,
          name: muscle.name,
          latinName: muscle.latinName,
          muscleGroupId: groupIdByCode.get(muscle.groupCode)!,
          description: muscle.description,
        })),
        {
          updateOnDuplicate: [
            "name",
            "latinName",
            "muscleGroupId",
            "description",
          ],
          transaction,
        },
      );
      const muscleIdByCode = new Map(
        (await this.muscleModel.findAll({ transaction })).map((muscle) => [
          muscle.code,
          muscle.id,
        ]),
      );

      // 2) Reconstrucción determinista de relaciones y ratings.
      const exercises = await this.sequelize.query<ExerciseRow>(
        `SELECT id, grupo_muscular, target_muscle, synergist_muscle_group,
                secondary_muscles, category, required_equipment
         FROM public.ejercicios`,
        { type: QueryTypes.SELECT, transaction },
      );
      await this.exerciseMuscleModel.destroy({ where: {}, transaction });
      await this.exerciseRatingModel.destroy({ where: {}, transaction });

      const muscleRows: Array<{
        exerciseId: string;
        muscleId: string;
        role: "PRIMARY" | "SECONDARY";
      }> = [];
      const ratingRows: Array<Record<string, unknown>> = [];
      let exercisesWithMuscles = 0;
      let exercisesUnmatched = 0;

      for (const exercise of exercises) {
        const primary = new Set<string>();
        const secondary = new Set<string>();
        const target = normalizeMuscleLabel(exercise.target_muscle);
        const group = normalizeMuscleLabel(exercise.grupo_muscular);
        if (target) primary.add(target);
        if (group) primary.add(group);
        const synergist = normalizeMuscleLabel(exercise.synergist_muscle_group);
        if (synergist) secondary.add(synergist);
        const rawSecondary = Array.isArray(exercise.secondary_muscles)
          ? exercise.secondary_muscles
          : [];
        for (const entry of rawSecondary) {
          const label =
            typeof entry === "string"
              ? entry
              : ((entry as { name?: string; muscle?: string })?.name ??
                (entry as { muscle?: string })?.muscle ??
                "");
          const code = normalizeMuscleLabel(label);
          if (code) secondary.add(code);
        }
        for (const code of primary) secondary.delete(code);

        if (primary.size > 0 || secondary.size > 0) exercisesWithMuscles += 1;
        else exercisesUnmatched += 1;

        for (const code of primary) {
          const muscleId = muscleIdByCode.get(code);
          if (muscleId)
            muscleRows.push({
              exerciseId: exercise.id,
              muscleId,
              role: "PRIMARY",
            });
        }
        for (const code of secondary) {
          const muscleId = muscleIdByCode.get(code);
          if (muscleId)
            muscleRows.push({
              exerciseId: exercise.id,
              muscleId,
              role: "SECONDARY",
            });
        }

        const rating = computeExerciseRating({
          category: exercise.category,
          requiredEquipment: exercise.required_equipment,
          primaryMuscleCount: primary.size,
          secondaryMuscleCount: secondary.size,
        });
        const now = new Date();
        ratingRows.push({
          exerciseId: exercise.id,
          recommendedStars: rating.recommendedStars,
          funStars: rating.funStars,
          factors: rating.factors,
          computedAt: now,
          updatedAt: now,
        });
      }

      for (let index = 0; index < muscleRows.length; index += CHUNK)
        await this.exerciseMuscleModel.bulkCreate(
          muscleRows.slice(index, index + CHUNK),
          { transaction },
        );
      for (let index = 0; index < ratingRows.length; index += CHUNK)
        await this.exerciseRatingModel.bulkCreate(
          ratingRows.slice(index, index + CHUNK),
          { transaction },
        );

      const result: EnrichmentResult = {
        groups: muscleGroups.length,
        muscles: muscles.length,
        exercises: exercises.length,
        exercisesWithMuscles,
        exercisesUnmatched,
        exerciseMuscleRows: muscleRows.length,
        ratings: ratingRows.length,
      };
      this.logger.log({ event: "exercise.enrichment.completed", ...result });
      return result;
    });
  }
}

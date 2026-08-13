import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { DatabaseModule } from "../database/database.module";
import { ExerciseEnrichmentService } from "../modules/exercises/muscles/exercise-enrichment.service";
import { ExerciseMuscleModel } from "../modules/exercises/muscles/exercise-muscle.model";
import { ExerciseRatingModel } from "../modules/exercises/muscles/exercise-rating.model";
import { MuscleGroupModel } from "../modules/exercises/muscles/muscle-group.model";
import { MuscleModel } from "../modules/exercises/muscles/muscle.model";

/**
 * Contexto mínimo para el comando de enriquecimiento (músculos + ratings): la
 * conexión a la base y los modelos del catálogo muscular. Sin superficie HTTP.
 */
@Module({
  imports: [
    DatabaseModule,
    SequelizeModule.forFeature([
      MuscleGroupModel,
      MuscleModel,
      ExerciseMuscleModel,
      ExerciseRatingModel,
    ]),
  ],
  providers: [ExerciseEnrichmentService],
})
export class ExerciseEnrichmentModule {}

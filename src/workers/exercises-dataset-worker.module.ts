import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ExercisesModule } from "../modules/exercises/exercises.module";
import { ExercisesDatasetRefreshRunner } from "./exercises-dataset-refresh.runner";

@Module({
  imports: [DatabaseModule, ExercisesModule],
  providers: [ExercisesDatasetRefreshRunner],
})
export class ExercisesDatasetWorkerModule {}

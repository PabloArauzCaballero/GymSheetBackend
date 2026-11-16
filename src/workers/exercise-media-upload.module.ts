import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { DatabaseModule } from "../database/database.module";
import { ExerciseEquipmentModel } from "../modules/exercises/exercise-equipment.model";
import { ExerciseMediaModel } from "../modules/exercises/exercise-media.model";
import { ExerciseMediaRepository } from "../modules/exercises/exercise-media.repository";
import { ExerciseMediaService } from "../modules/exercises/exercise-media.service";
import { ExerciseModel } from "../modules/exercises/exercise.model";
import { ExercisesRepository } from "../modules/exercises/exercises.repository";
import { PersonalExerciseMediaRelease } from "../modules/exercises/personal-exercise-media-release";
import { ExerciseLibraryRepository } from "../modules/exercises/import/exercise-library.repository";
import { UserExerciseModel } from "../modules/exercises/user-exercise.model";
import { MediaModule } from "../modules/media/media.module";
import { UsersModule } from "../modules/users/users.module";

/**
 * Contexto mínimo para la carga por lotes de demostraciones
 * (`db:media:ejercicios` y `db:import:biblioteca`): base de datos, catálogo de
 * ejercicios, media y el proveedor de almacenamiento configurado. Sin
 * superficie HTTP.
 *
 * Reutiliza `ExerciseMediaService` en vez de escribir filas por su cuenta: la
 * validación, el límite de medios activos y la invariante del principal viven
 * ahí, y un comando con su propia copia de esas reglas es la forma segura de
 * que acaben divergiendo.
 */
@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    // The configured storage provider and the media release queue a personal
    // exercise's upload needs (ADR-0017); the same wiring as the API.
    MediaModule,
    SequelizeModule.forFeature([
      ExerciseModel,
      ExerciseEquipmentModel,
      UserExerciseModel,
      ExerciseMediaModel,
    ]),
  ],
  providers: [
    ExercisesRepository,
    ExerciseLibraryRepository,
    ExerciseMediaRepository,
    ExerciseMediaService,
    PersonalExerciseMediaRelease,
  ],
})
export class ExerciseMediaUploadModule {}

import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { env } from "../config/env";
import { DatabaseModule } from "../database/database.module";
import { ExerciseEquipmentModel } from "../modules/exercises/exercise-equipment.model";
import { ExerciseMediaModel } from "../modules/exercises/exercise-media.model";
import { ExerciseMediaRepository } from "../modules/exercises/exercise-media.repository";
import { ExerciseMediaService } from "../modules/exercises/exercise-media.service";
import { ExerciseModel } from "../modules/exercises/exercise.model";
import { ExercisesRepository } from "../modules/exercises/exercises.repository";
import { UserExerciseModel } from "../modules/exercises/user-exercise.model";
import { createMediaStorageProvider } from "../modules/media/media-storage.factory";
import { MEDIA_STORAGE_PROVIDER } from "../modules/media/media-storage.port";
import { UsersModule } from "../modules/users/users.module";

/**
 * Contexto mínimo para la carga por lotes de demostraciones: base de datos,
 * catálogo de ejercicios, media y el proveedor de almacenamiento configurado.
 * Sin superficie HTTP.
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
    SequelizeModule.forFeature([
      ExerciseModel,
      ExerciseEquipmentModel,
      UserExerciseModel,
      ExerciseMediaModel,
    ]),
  ],
  providers: [
    ExercisesRepository,
    ExerciseMediaRepository,
    ExerciseMediaService,
    {
      provide: MEDIA_STORAGE_PROVIDER,
      useFactory: () =>
        createMediaStorageProvider({
          provider: env.MEDIA_STORAGE_PROVIDER,
          localRoot: env.MEDIA_STORAGE_LOCAL_ROOT,
          publicBaseUrl: env.MEDIA_STORAGE_PUBLIC_BASE_URL,
          minio: {
            endPoint: env.MINIO_ENDPOINT,
            port: env.MINIO_PORT,
            useSSL: env.MINIO_USE_SSL,
            accessKey: env.MINIO_ACCESS_KEY,
            secretKey: env.MINIO_SECRET_KEY,
            bucket: env.MINIO_BUCKET,
            region: env.MINIO_REGION,
          },
        }),
    },
  ],
})
export class ExerciseMediaUploadModule {}

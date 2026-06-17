import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { EquipmentModel } from '../equipment/equipment.model';
import { AdminExercisesController, ExercisesController, UserExercisesController } from './exercises.controller';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseModel } from './exercise.model';
import { ExercisesRepository } from './exercises.repository';
import { ExercisesService } from './exercises.service';
import { UserExerciseModel } from './user-exercise.model';

@Module({
  imports: [SequelizeModule.forFeature([ExerciseModel, ExerciseEquipmentModel, UserExerciseModel, EquipmentModel])],
  controllers: [ExercisesController, AdminExercisesController, UserExercisesController],
  providers: [ExercisesRepository, ExercisesService],
  exports: [ExercisesService, ExercisesRepository],
})
export class ExercisesModule {}

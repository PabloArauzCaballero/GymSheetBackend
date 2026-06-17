import { Transaction } from 'sequelize';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseModel } from './exercise.model';
import { UserExerciseModel } from './user-exercise.model';
import { CreateGlobalExerciseInput, CreatePersonalExerciseInput, ExerciseFilterInput, UpdateExerciseInput } from './exercises.schemas';
export declare class ExercisesRepository {
    private readonly exerciseModel;
    private readonly exerciseEquipmentModel;
    private readonly userExerciseModel;
    constructor(exerciseModel: typeof ExerciseModel, exerciseEquipmentModel: typeof ExerciseEquipmentModel, userExerciseModel: typeof UserExerciseModel);
    listVisibleForUser(userId: string, filters: ExerciseFilterInput): Promise<ExerciseModel[]>;
    findVisibleById(id: string, userId: string): Promise<ExerciseModel | null>;
    createGlobal(input: CreateGlobalExerciseInput, transaction?: Transaction): Promise<ExerciseModel>;
    createPersonal(userId: string, input: CreatePersonalExerciseInput, transaction?: Transaction): Promise<ExerciseModel>;
    replaceExerciseEquipment(ejercicioId: string, equipoIds: string[], transaction?: Transaction): Promise<void>;
    updateExercise(exercise: ExerciseModel, input: UpdateExerciseInput, transaction?: Transaction): Promise<ExerciseModel>;
    markInactive(exercise: ExerciseModel): Promise<ExerciseModel>;
    findFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel | null>;
    listFavorites(userId: string): Promise<UserExerciseModel[]>;
    createFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel>;
    deleteFavorite(userId: string, exerciseId: string): Promise<number>;
}

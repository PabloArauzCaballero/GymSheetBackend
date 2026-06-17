import { Sequelize } from 'sequelize-typescript';
import { ExercisesRepository } from './exercises.repository';
import { CreateGlobalExerciseInput, CreatePersonalExerciseInput, ExerciseFilterInput, UpdateExerciseInput } from './exercises.schemas';
export declare class ExercisesService {
    private readonly exercisesRepository;
    private readonly sequelize;
    constructor(exercisesRepository: ExercisesRepository, sequelize: Sequelize);
    listVisibleForUser(userId: string, filters: ExerciseFilterInput): Promise<import("./exercise.model").ExerciseModel[]>;
    getVisibleExerciseOrFail(exerciseId: string, userId: string): Promise<import("./exercise.model").ExerciseModel>;
    createGlobalExercise(input: CreateGlobalExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    createPersonalExercise(userId: string, input: CreatePersonalExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    updatePersonalExercise(userId: string, exerciseId: string, input: UpdateExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    updateGlobalExercise(exerciseId: string, input: UpdateExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    inactivatePersonalExercise(userId: string, exerciseId: string): Promise<import("./exercise.model").ExerciseModel>;
    inactivateGlobalExercise(exerciseId: string): Promise<import("./exercise.model").ExerciseModel>;
    listFavorites(userId: string): Promise<import("./user-exercise.model").UserExerciseModel[]>;
    addFavorite(userId: string, exerciseId: string): Promise<import("./user-exercise.model").UserExerciseModel>;
    removeFavorite(userId: string, exerciseId: string): Promise<{
        deleted: boolean;
    }>;
}

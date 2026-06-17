import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ExercisesService } from './exercises.service';
import { CreateGlobalExerciseInput, CreatePersonalExerciseInput, ExerciseFilterInput, UpdateExerciseInput } from './exercises.schemas';
export declare class ExercisesController {
    private readonly exercisesService;
    constructor(exercisesService: ExercisesService);
    listExercises(currentUser: AuthenticatedUser, filters: ExerciseFilterInput): Promise<import("./exercise.model").ExerciseModel[]>;
    getExercise(currentUser: AuthenticatedUser, id: string): Promise<import("./exercise.model").ExerciseModel>;
    createPersonalExercise(currentUser: AuthenticatedUser, input: CreatePersonalExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    updatePersonalExercise(currentUser: AuthenticatedUser, id: string, input: UpdateExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    inactivatePersonalExercise(currentUser: AuthenticatedUser, id: string): Promise<import("./exercise.model").ExerciseModel>;
}
export declare class AdminExercisesController {
    private readonly exercisesService;
    constructor(exercisesService: ExercisesService);
    createGlobalExercise(input: CreateGlobalExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    updateGlobalExercise(id: string, input: UpdateExerciseInput): Promise<import("./exercise.model").ExerciseModel | null>;
    inactivateGlobalExercise(id: string): Promise<import("./exercise.model").ExerciseModel>;
}
export declare class UserExercisesController {
    private readonly exercisesService;
    constructor(exercisesService: ExercisesService);
    listFavorites(currentUser: AuthenticatedUser): Promise<import("./user-exercise.model").UserExerciseModel[]>;
    addFavorite(currentUser: AuthenticatedUser, exerciseId: string): Promise<import("./user-exercise.model").UserExerciseModel>;
    removeFavorite(currentUser: AuthenticatedUser, exerciseId: string): Promise<{
        deleted: boolean;
    }>;
}

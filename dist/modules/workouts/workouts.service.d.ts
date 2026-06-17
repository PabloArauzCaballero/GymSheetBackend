import { Sequelize } from 'sequelize-typescript';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSetModel } from './workout-set.model';
import { WorkoutsRepository } from './workouts.repository';
import { AddSessionExerciseInput, CreateWorkoutSessionInput, CreateWorkoutSetInput, UpdateSessionExerciseInput, UpdateWorkoutSetInput } from './workouts.schemas';
export declare class WorkoutsService {
    private readonly workoutsRepository;
    private readonly exercisesService;
    private readonly sequelize;
    constructor(workoutsRepository: WorkoutsRepository, exercisesService: ExercisesService, sequelize: Sequelize);
    startSession(userId: string, input: CreateWorkoutSessionInput): Promise<import("./workout-session.model").WorkoutSessionModel>;
    listMySessions(userId: string): Promise<import("./workout-session.model").WorkoutSessionModel[]>;
    getMySession(userId: string, sessionId: string): Promise<import("./workout-session.model").WorkoutSessionModel>;
    finishSession(userId: string, sessionId: string): Promise<import("./workout-session.model").WorkoutSessionModel>;
    cancelSession(userId: string, sessionId: string): Promise<import("./workout-session.model").WorkoutSessionModel>;
    addExerciseToSession(userId: string, sessionId: string, input: AddSessionExerciseInput): Promise<WorkoutSessionExerciseModel>;
    updateSessionExercise(userId: string, sessionExerciseId: string, input: UpdateSessionExerciseInput): Promise<WorkoutSessionExerciseModel>;
    deleteSessionExercise(userId: string, sessionExerciseId: string): Promise<{
        deleted: boolean;
    }>;
    addSet(userId: string, sessionExerciseId: string, input: CreateWorkoutSetInput): Promise<WorkoutSetModel>;
    updateSet(userId: string, setId: string, input: UpdateWorkoutSetInput): Promise<WorkoutSetModel>;
    deleteSet(userId: string, setId: string): Promise<{
        deleted: boolean;
    }>;
    private getSessionExerciseOwnedByUserOrFail;
    private getSetOwnedByUserOrFail;
    private assertSessionInProgress;
}

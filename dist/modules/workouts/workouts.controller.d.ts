import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { WorkoutsService } from './workouts.service';
import { AddSessionExerciseInput, CreateWorkoutSessionInput, CreateWorkoutSetInput, UpdateSessionExerciseInput, UpdateWorkoutSetInput } from './workouts.schemas';
export declare class WorkoutsController {
    private readonly workoutsService;
    constructor(workoutsService: WorkoutsService);
    startSession(currentUser: AuthenticatedUser, input: CreateWorkoutSessionInput): Promise<import("./workout-session.model").WorkoutSessionModel>;
    listMySessions(currentUser: AuthenticatedUser): Promise<import("./workout-session.model").WorkoutSessionModel[]>;
    getMySession(currentUser: AuthenticatedUser, id: string): Promise<import("./workout-session.model").WorkoutSessionModel>;
    finishSession(currentUser: AuthenticatedUser, id: string): Promise<import("./workout-session.model").WorkoutSessionModel>;
    cancelSession(currentUser: AuthenticatedUser, id: string): Promise<import("./workout-session.model").WorkoutSessionModel>;
    addExerciseToSession(currentUser: AuthenticatedUser, sessionId: string, input: AddSessionExerciseInput): Promise<import("./workout-session-exercise.model").WorkoutSessionExerciseModel>;
    updateSessionExercise(currentUser: AuthenticatedUser, id: string, input: UpdateSessionExerciseInput): Promise<import("./workout-session-exercise.model").WorkoutSessionExerciseModel>;
    deleteSessionExercise(currentUser: AuthenticatedUser, id: string): Promise<{
        deleted: boolean;
    }>;
    addSet(currentUser: AuthenticatedUser, id: string, input: CreateWorkoutSetInput): Promise<import("./workout-set.model").WorkoutSetModel>;
    updateSet(currentUser: AuthenticatedUser, id: string, input: UpdateWorkoutSetInput): Promise<import("./workout-set.model").WorkoutSetModel>;
    deleteSet(currentUser: AuthenticatedUser, id: string): Promise<{
        deleted: boolean;
    }>;
}

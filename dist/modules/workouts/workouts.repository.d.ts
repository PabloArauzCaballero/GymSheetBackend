import { Transaction } from 'sequelize';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
import { AddSessionExerciseInput, CreateWorkoutSessionInput, CreateWorkoutSetInput, UpdateSessionExerciseInput, UpdateWorkoutSetInput } from './workouts.schemas';
export declare class WorkoutsRepository {
    private readonly sessionModel;
    private readonly sessionExerciseModel;
    private readonly setModel;
    constructor(sessionModel: typeof WorkoutSessionModel, sessionExerciseModel: typeof WorkoutSessionExerciseModel, setModel: typeof WorkoutSetModel);
    createSession(userId: string, input: CreateWorkoutSessionInput): Promise<WorkoutSessionModel>;
    findSessionByIdForUser(sessionId: string, userId: string): Promise<WorkoutSessionModel | null>;
    listSessionsForUser(userId: string): Promise<WorkoutSessionModel[]>;
    changeSessionStatus(session: WorkoutSessionModel, status: WorkoutSessionStatus): Promise<WorkoutSessionModel>;
    addExerciseToSession(sessionId: string, input: AddSessionExerciseInput): Promise<WorkoutSessionExerciseModel>;
    findSessionExerciseById(id: string): Promise<WorkoutSessionExerciseModel | null>;
    updateSessionExercise(sessionExercise: WorkoutSessionExerciseModel, input: UpdateSessionExerciseInput): Promise<WorkoutSessionExerciseModel>;
    deleteSessionExercise(id: string): Promise<number>;
    findSetBySessionExerciseAndNumber(sessionExerciseId: string, numeroSerie: number): Promise<WorkoutSetModel | null>;
    createSet(sessionExerciseId: string, input: CreateWorkoutSetInput, transaction?: Transaction): Promise<WorkoutSetModel>;
    findSetById(id: string): Promise<WorkoutSetModel | null>;
    updateSet(set: WorkoutSetModel, input: UpdateWorkoutSetInput): Promise<WorkoutSetModel>;
    deleteSet(id: string): Promise<number>;
}

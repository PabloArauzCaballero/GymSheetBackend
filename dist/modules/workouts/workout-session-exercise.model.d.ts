import { Model } from 'sequelize-typescript';
import { ExerciseModel } from '../exercises/exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';
export declare class WorkoutSessionExerciseModel extends Model {
    id: string;
    sesionId: string;
    ejercicioId: string;
    orden: number;
    esEnfasis: boolean;
    nota: string | null;
    sesion?: WorkoutSessionModel;
    ejercicio?: ExerciseModel;
    series?: WorkoutSetModel[];
    createdAt: Date;
    updatedAt: Date;
}

import { Model } from 'sequelize-typescript';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
export declare class WorkoutSetModel extends Model {
    id: string;
    sesionEjercicioId: string;
    numeroSerie: number;
    repeticiones: number;
    pesoKg: string;
    rir: number;
    descansoSegAnterior: number;
    fechaRegistro: Date;
    sesionEjercicio?: WorkoutSessionExerciseModel;
    createdAt: Date;
    updatedAt: Date;
}

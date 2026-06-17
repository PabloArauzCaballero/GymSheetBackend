import { Model } from 'sequelize-typescript';
import { UserModel } from '../users/user.model';
import { ExerciseModel } from './exercise.model';
export declare class UserExerciseModel extends Model {
    id: string;
    usuarioId: string;
    ejercicioId: string;
    fechaSeleccion: Date;
    usuario?: UserModel;
    ejercicio?: ExerciseModel;
    createdAt: Date;
    updatedAt: Date;
}

import { Model } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { WorkoutSessionExerciseModel } from './workout-session-exercise.model';
export declare class WorkoutSessionModel extends Model {
    id: string;
    usuarioId: string;
    fechaInicio: Date;
    fechaFin: Date | null;
    estado: WorkoutSessionStatus;
    observacion: string | null;
    usuario?: UserModel;
    ejercicios?: WorkoutSessionExerciseModel[];
    createdAt: Date;
    updatedAt: Date;
}

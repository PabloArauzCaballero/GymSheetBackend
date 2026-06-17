import { Model } from 'sequelize-typescript';
import { TrainingGoal } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
export declare class AnthropometricProfileModel extends Model {
    id: string;
    usuarioId: string;
    edad: number;
    pesoKg: string;
    estaturaCm: number;
    objetivo: TrainingGoal;
    fechaActualizacion: Date;
    usuario?: UserModel;
    createdAt: Date;
    updatedAt: Date;
}

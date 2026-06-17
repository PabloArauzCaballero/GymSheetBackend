import { Model } from 'sequelize-typescript';
import { UserRole, UserStatus } from '../../common/enums/domain.enums';
import { AnthropometricProfileModel } from '../profiles/anthropometric-profile.model';
export declare class UserModel extends Model {
    id: string;
    email: string;
    passwordHash: string;
    nombreCompleto: string;
    rol: UserRole;
    estado: UserStatus;
    fechaRegistro: Date;
    perfilAntropometrico?: AnthropometricProfileModel;
    createdAt: Date;
    updatedAt: Date;
}

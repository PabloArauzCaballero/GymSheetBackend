import { Model } from 'sequelize-typescript';
import { ExerciseStatus, ExerciseType } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
export declare class ExerciseModel extends Model {
    id: string;
    nombre: string;
    grupoMuscular: string;
    descripcion: string | null;
    tipoEjercicio: ExerciseType;
    createdByUsuarioId: string | null;
    estado: ExerciseStatus;
    createdByUsuario?: UserModel;
    equipos?: ExerciseEquipmentModel[];
    createdAt: Date;
    updatedAt: Date;
}

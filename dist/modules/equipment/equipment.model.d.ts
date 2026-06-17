import { Model } from 'sequelize-typescript';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';
export declare class EquipmentModel extends Model {
    id: string;
    nombre: string;
    tipo: EquipmentType;
    descripcion: string | null;
    estado: EquipmentStatus;
    createdAt: Date;
    updatedAt: Date;
}

import { Model } from 'sequelize-typescript';
import { EquipmentModel } from '../equipment/equipment.model';
import { ExerciseModel } from './exercise.model';
export declare class ExerciseEquipmentModel extends Model {
    id: string;
    ejercicioId: string;
    equipoGymId: string;
    ejercicio?: ExerciseModel;
    equipo?: EquipmentModel;
    createdAt: Date;
    updatedAt: Date;
}

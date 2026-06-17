import { EquipmentModel } from './equipment.model';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';
export declare class EquipmentRepository {
    private readonly equipmentModel;
    constructor(equipmentModel: typeof EquipmentModel);
    findAvailable(): Promise<EquipmentModel[]>;
    findById(id: string): Promise<EquipmentModel | null>;
    create(input: CreateEquipmentInput): Promise<EquipmentModel>;
    update(id: string, input: UpdateEquipmentInput): Promise<EquipmentModel | null>;
    markInactive(id: string): Promise<EquipmentModel | null>;
}

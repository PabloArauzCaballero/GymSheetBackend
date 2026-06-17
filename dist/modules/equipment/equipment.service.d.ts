import { EquipmentRepository } from './equipment.repository';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';
export declare class EquipmentService {
    private readonly equipmentRepository;
    constructor(equipmentRepository: EquipmentRepository);
    listAvailableEquipment(): Promise<import("./equipment.model").EquipmentModel[]>;
    createEquipment(input: CreateEquipmentInput): Promise<import("./equipment.model").EquipmentModel>;
    updateEquipment(id: string, input: UpdateEquipmentInput): Promise<import("./equipment.model").EquipmentModel>;
    inactivateEquipment(id: string): Promise<import("./equipment.model").EquipmentModel>;
}

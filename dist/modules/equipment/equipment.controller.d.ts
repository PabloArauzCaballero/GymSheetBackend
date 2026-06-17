import { EquipmentService } from './equipment.service';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';
export declare class EquipmentController {
    private readonly equipmentService;
    constructor(equipmentService: EquipmentService);
    listAvailableEquipment(): Promise<import("./equipment.model").EquipmentModel[]>;
}
export declare class AdminEquipmentController {
    private readonly equipmentService;
    constructor(equipmentService: EquipmentService);
    createEquipment(input: CreateEquipmentInput): Promise<import("./equipment.model").EquipmentModel>;
    updateEquipment(id: string, input: UpdateEquipmentInput): Promise<import("./equipment.model").EquipmentModel>;
    inactivateEquipment(id: string): Promise<import("./equipment.model").EquipmentModel>;
}

import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutsService } from '../workouts/workouts.service';
export declare class ExportService {
    private readonly usersService;
    private readonly profilesService;
    private readonly equipmentService;
    private readonly workoutsService;
    constructor(usersService: UsersService, profilesService: ProfilesService, equipmentService: EquipmentService, workoutsService: WorkoutsService);
    buildWorkoutHistoryExport(userId: string): Promise<{
        usuario: {
            id: string;
            email: string;
            nombreCompleto: string;
        };
        perfil: import("../profiles/anthropometric-profile.model").AnthropometricProfileModel;
        sesiones: import("../workouts/workout-session.model").WorkoutSessionModel[];
        catalogoDisponible: import("../equipment/equipment.model").EquipmentModel[];
        generadoEn: string;
    }>;
    buildWorkoutHistoryCsv(userId: string): Promise<string>;
}

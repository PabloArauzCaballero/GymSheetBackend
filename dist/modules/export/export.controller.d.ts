import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ExportService } from './export.service';
export declare class ExportController {
    private readonly exportService;
    constructor(exportService: ExportService);
    exportWorkoutHistory(currentUser: AuthenticatedUser): Promise<{
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
    exportWorkoutHistoryCsv(currentUser: AuthenticatedUser): Promise<string>;
}

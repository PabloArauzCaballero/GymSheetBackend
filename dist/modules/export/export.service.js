"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportService = void 0;
const common_1 = require("@nestjs/common");
const equipment_service_1 = require("../equipment/equipment.service");
const profiles_service_1 = require("../profiles/profiles.service");
const users_service_1 = require("../users/users.service");
const workouts_service_1 = require("../workouts/workouts.service");
let ExportService = class ExportService {
    constructor(usersService, profilesService, equipmentService, workoutsService) {
        this.usersService = usersService;
        this.profilesService = profilesService;
        this.equipmentService = equipmentService;
        this.workoutsService = workoutsService;
    }
    async buildWorkoutHistoryExport(userId) {
        const [user, profile, sessions, equipment] = await Promise.all([
            this.usersService.getActiveUserOrFail(userId),
            this.profilesService.getMyProfile(userId),
            this.workoutsService.listMySessions(userId),
            this.equipmentService.listAvailableEquipment(),
        ]);
        return {
            usuario: {
                id: user.id,
                email: user.email,
                nombreCompleto: user.nombreCompleto,
            },
            perfil: profile,
            sesiones: sessions,
            catalogoDisponible: equipment,
            generadoEn: new Date().toISOString(),
        };
    }
    async buildWorkoutHistoryCsv(userId) {
        const exportData = await this.buildWorkoutHistoryExport(userId);
        const rows = ['fecha_inicio,estado,ejercicio,serie,repeticiones,peso_kg,rir,descanso_seg_anterior,es_enfasis'];
        for (const session of exportData.sesiones) {
            for (const sessionExercise of session.ejercicios ?? []) {
                for (const set of sessionExercise.series ?? []) {
                    rows.push([
                        session.fechaInicio.toISOString(),
                        session.estado,
                        sessionExercise.ejercicio?.nombre ?? '',
                        set.numeroSerie,
                        set.repeticiones,
                        set.pesoKg,
                        set.rir,
                        set.descansoSegAnterior,
                        sessionExercise.esEnfasis,
                    ].join(','));
                }
            }
        }
        return rows.join('\n');
    }
};
exports.ExportService = ExportService;
exports.ExportService = ExportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        profiles_service_1.ProfilesService,
        equipment_service_1.EquipmentService,
        workouts_service_1.WorkoutsService])
], ExportService);
//# sourceMappingURL=export.service.js.map
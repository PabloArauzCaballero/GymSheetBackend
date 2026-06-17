import { Injectable } from '@nestjs/common';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutsService } from '../workouts/workouts.service';

@Injectable()
export class ExportService {
  constructor(
    private readonly usersService: UsersService,
    private readonly profilesService: ProfilesService,
    private readonly equipmentService: EquipmentService,
    private readonly workoutsService: WorkoutsService,
  ) {}

  async buildWorkoutHistoryExport(userId: string) {
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

  async buildWorkoutHistoryCsv(userId: string): Promise<string> {
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
}

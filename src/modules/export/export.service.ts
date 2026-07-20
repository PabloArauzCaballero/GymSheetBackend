import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORTED_SESSIONS = 1000;

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
      this.listSessionsForExport(userId),
      this.equipmentService.listAvailableEquipment(),
    ]);

    return {
      usuario: {
        id: user.id,
        email: user.email,
        nombreCompleto: user.fullName,
      },
      perfil: profile,
      sesiones: sessions,
      catalogoDisponible: equipment,
      generadoEn: new Date().toISOString(),
    };
  }

  async buildWorkoutHistoryCsv(userId: string): Promise<string> {
    const exportData = await this.buildWorkoutHistoryExport(userId);
    const rows = [
      [
        'fecha_inicio',
        'estado',
        'ejercicio',
        'serie',
        'repeticiones',
        'peso_kg',
        'rir',
        'descanso_seg_anterior',
        'es_enfasis',
      ].join(','),
    ];

    for (const session of exportData.sesiones) {
      for (const sessionExercise of session.ejercicios) {
        for (const set of sessionExercise.series) {
          rows.push(
            [
              session.fechaInicio.toISOString(),
              session.estado,
              sessionExercise.ejercicio?.nombre ?? '',
              set.numeroSerie,
              set.repeticiones,
              set.pesoKg,
              set.rir,
              set.descansoSegAnterior,
              sessionExercise.esEnfasis,
            ]
              .map((value) => this.escapeCsvCell(value))
              .join(','),
          );
        }
      }
    }

    return `${rows.join('\n')}\n`;
  }

  /**
   * Reads history in bounded pages. Large exports must be moved to an
   * asynchronous job rather than allocating an unbounded in-memory payload.
   */
  private async listSessionsForExport(userId: string): Promise<WorkoutSessionResponse[]> {
    const sessions: WorkoutSessionResponse[] = [];
    let page = 1;

    while (sessions.length < MAX_EXPORTED_SESSIONS) {
      const result = await this.workoutsService.listMySessions(userId, {
        page,
        pageSize: EXPORT_PAGE_SIZE,
      });
      sessions.push(...result.items);

      if (page >= result.totalPages) {
        return sessions;
      }
      page += 1;
    }

    throw new PayloadTooLargeException(
      `La exportación supera el límite síncrono de ${MAX_EXPORTED_SESSIONS} sesiones.`,
    );
  }

  private escapeCsvCell(value: string | number | boolean): string {
    const serializedValue = String(value);
    const formulaSafeValue = /^[=+\-@]/.test(serializedValue)
      ? `'${serializedValue}`
      : serializedValue;
    return `"${formulaSafeValue.replace(/"/g, '""')}"`;
  }
}

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


  /**
   * Informe de avance en PDF.
   *
   * El CSV sirve para analizar; este documento sirve para enseñar — a un
   * entrenador, a un fisio, a quien pida constancia del trabajo hecho. Por eso
   * lidera con el resumen agregado y no con las filas: nadie lee 200 series
   * para saber si alguien entrena.
   *
   * Se compone con PDFKit en memoria y sin navegador headless: el documento es
   * texto y reglas, y arrastrar Chromium a la imagen del servidor para dibujar
   * una tabla no se paga.
   */
  async buildWorkoutHistoryPdf(userId: string): Promise<Buffer> {
    const data = await this.buildWorkoutHistoryExport(userId);

    const finished = data.sesiones.filter(
      (session) => session.estado === 'FINALIZADA',
    );
    let totalSets = 0;
    let totalVolume = 0;
    for (const session of data.sesiones) {
      for (const sessionExercise of session.ejercicios) {
        for (const set of sessionExercise.series) {
          totalSets += 1;
          totalVolume += set.pesoKg * set.repeticiones;
        }
      }
    }

    // `PDFDocument` se importa aquí y no arriba: sólo esta ruta lo necesita y
    // mantenerlo fuera del arranque evita cargarlo en cada boot del proceso.
    const { default: PDFDocument } = await import('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 48 });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished$ = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    doc.fontSize(22).text('Informe de avance', { align: 'left' });
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .fillColor('#555555')
      .text(`${data.usuario.nombreCompleto} · ${data.usuario.email}`);
    doc.text(`Generado el ${new Date(data.generadoEn).toLocaleString('es-BO')}`);
    doc.moveDown();

    doc.fillColor('#000000').fontSize(13).text('Resumen');
    doc.moveDown(0.3);
    doc.fontSize(10);
    doc.text(`Sesiones registradas: ${data.sesiones.length}`);
    doc.text(`Sesiones finalizadas: ${finished.length}`);
    doc.text(`Series registradas: ${totalSets}`);
    doc.text(`Volumen total: ${Math.round(totalVolume)} kg`);
    if (data.perfil) {
      doc.text(
        `Perfil: ${data.perfil.pesoKg} kg · ${data.perfil.estaturaCm} cm · ${data.perfil.objetivo}`,
      );
    }
    doc.moveDown();

    doc.fontSize(13).text('Sesiones');
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#555555');

    // Sólo las más recientes: un PDF de cientos de páginas no lo abre nadie, y
    // el CSV sigue siendo la vía para el histórico completo.
    for (const session of data.sesiones.slice(0, 40)) {
      const started = new Date(session.fechaInicio);
      const sets = session.ejercicios.reduce(
        (sum, item) => sum + item.series.length,
        0,
      );
      const volume = session.ejercicios.reduce(
        (sum, item) =>
          sum +
          item.series.reduce(
            (acc, set) => acc + set.pesoKg * set.repeticiones,
            0,
          ),
        0,
      );
      doc
        .fillColor('#000000')
        .text(
          `${started.toLocaleDateString('es-BO')} ${started
            .toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}` +
            `  ·  ${session.estado}  ·  ${session.ejercicios.length} ejercicios` +
            `  ·  ${sets} series  ·  ${Math.round(volume)} kg`,
        );
    }

    if (data.sesiones.length > 40) {
      doc.moveDown(0.5);
      doc
        .fillColor('#555555')
        .text(
          `Se muestran las 40 sesiones más recientes de ${data.sesiones.length}. ` +
            'El histórico completo está en la exportación CSV.',
        );
    }

    doc.end();
    return finished$;
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

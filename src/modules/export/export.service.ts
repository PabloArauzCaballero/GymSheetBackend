import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';

/** El PDF lo lee una persona, no un sistema: los enums se traducen. */
const STATUS_LABEL: Record<string, string> = {
  EN_PROGRESO: 'En progreso',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
};

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
   * Lleva la identidad de la app en vez de ser texto suelto: banda oscura con
   * el acento volt, cifras grandes como en las tarjetas de la pantalla de
   * inicio y una tabla con filas alternas. Un informe que el usuario reenvía a
   * su entrenador es la cara del producto fuera del producto.
   *
   * Se compone con PDFKit en memoria y sin navegador headless: el documento es
   * texto y reglas, y arrastrar Chromium a la imagen del servidor para dibujar
   * una tabla no se paga.
   */
  async buildWorkoutHistoryPdf(userId: string): Promise<Buffer> {
    const data = await this.buildWorkoutHistoryExport(userId);

    const finishedSessions = data.sesiones.filter(
      (session) => session.estado === WorkoutSessionStatus.COMPLETED,
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

    const INK = '#14160e';
    const MUTED = '#6b7280';
    const HAIRLINE = '#e5e7eb';
    const BAND = '#101010';
    const VOLT = '#c3f400';

    const MARGIN = 44;
    // `bufferPages` es obligatorio para volver atrás y numerar el pie: sin él,
    // `switchToPage` lanza porque las páginas ya se habrían vaciado al stream.
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - MARGIN * 2;

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const rendered = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // --- Cabecera: banda oscura a sangre, como el fondo de la app ---
    const HEADER_HEIGHT = 132;
    doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(BAND);
    // Filete volt inferior: el único trazo saturado del documento.
    doc.rect(0, HEADER_HEIGHT - 4, pageWidth, 4).fill(VOLT);

    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(26)
      .text('Informe de avance', MARGIN, 38, { width: contentWidth });
    doc
      .fillColor('#9ca3af')
      .font('Helvetica')
      .fontSize(10)
      .text(data.usuario.nombreCompleto, MARGIN, 74)
      .text(data.usuario.email, MARGIN, 88);
    doc
      .fillColor('#6b7280')
      .fontSize(9)
      .text(
        `Generado el ${new Date(data.generadoEn).toLocaleDateString('es-BO', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })}`,
        MARGIN,
        88,
        { width: contentWidth, align: 'right' },
      );

    // --- Tarjetas de cifras: el mismo lenguaje que la pantalla de inicio ---
    const cards: ReadonlyArray<{ value: string; label: string }> = [
      { value: String(data.sesiones.length), label: 'Sesiones' },
      { value: String(finishedSessions.length), label: 'Finalizadas' },
      { value: String(totalSets), label: 'Series' },
      { value: `${Math.round(totalVolume)} kg`, label: 'Volumen total' },
    ];
    const gap = 10;
    const cardWidth = (contentWidth - gap * (cards.length - 1)) / cards.length;
    const cardTop = HEADER_HEIGHT + 26;
    const cardHeight = 62;

    cards.forEach((card, index) => {
      const x = MARGIN + index * (cardWidth + gap);
      doc
        .roundedRect(x, cardTop, cardWidth, cardHeight, 8)
        .lineWidth(1)
        .strokeColor(HAIRLINE)
        .stroke();
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(card.value, x, cardTop + 14, { width: cardWidth, align: 'center' });
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8)
        .text(card.label.toUpperCase(), x, cardTop + 40, {
          width: cardWidth,
          align: 'center',
          characterSpacing: 0.6,
        });
    });

    if (data.perfil) {
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9)
        .text(
          `Perfil · ${data.perfil.pesoKg} kg · ${data.perfil.estaturaCm} cm · ${data.perfil.objetivo}`,
          MARGIN,
          cardTop + cardHeight + 14,
          { width: contentWidth },
        );
    }

    // --- Tabla de sesiones ---
    let y = cardTop + cardHeight + (data.perfil ? 42 : 28);

    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Sesiones', MARGIN, y);
    y += 22;

    const columns = [
      { key: 'fecha', label: 'Fecha', width: 96, align: 'left' as const },
      { key: 'estado', label: 'Estado', width: 92, align: 'left' as const },
      { key: 'ejercicios', label: 'Ejercicios', width: 80, align: 'right' as const },
      { key: 'series', label: 'Series', width: 70, align: 'right' as const },
      { key: 'volumen', label: 'Volumen', width: 0, align: 'right' as const },
    ];
    const fixed = columns.reduce((sum, column) => sum + column.width, 0);
    columns[columns.length - 1].width = contentWidth - fixed;

    const drawHeaderRow = () => {
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
      let x = MARGIN;
      for (const column of columns) {
        doc.text(column.label.toUpperCase(), x, y, {
          width: column.width,
          align: column.align,
          characterSpacing: 0.5,
        });
        x += column.width;
      }
      y += 14;
      doc
        .moveTo(MARGIN, y)
        .lineTo(MARGIN + contentWidth, y)
        .lineWidth(1)
        .strokeColor(HAIRLINE)
        .stroke();
      y += 6;
    };
    drawHeaderRow();

    const ROW_HEIGHT = 18;
    const visible = data.sesiones.slice(0, 60);

    visible.forEach((session, index) => {
      // Salto de página manteniendo la cabecera de la tabla: una tabla que
      // continúa sin encabezados obliga a volver atrás para saber qué se lee.
      if (y + ROW_HEIGHT > doc.page.height - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
        drawHeaderRow();
      }

      if (index % 2 === 1) {
        doc
          .rect(MARGIN - 4, y - 4, contentWidth + 8, ROW_HEIGHT)
          .fill('#fafafa');
      }

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
      const values = [
        `${started.toLocaleDateString('es-BO')} ${started.toLocaleTimeString('es-BO', {
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        STATUS_LABEL[session.estado] ?? session.estado,
        String(session.ejercicios.length),
        String(sets),
        `${Math.round(volume)} kg`,
      ];

      doc.font('Helvetica').fontSize(9).fillColor(INK);
      let x = MARGIN;
      values.forEach((value, columnIndex) => {
        const column = columns[columnIndex];
        doc.text(value, x, y, { width: column.width, align: column.align });
        x += column.width;
      });
      y += ROW_HEIGHT;
    });

    if (data.sesiones.length > visible.length) {
      y += 8;
      doc
        .fillColor(MUTED)
        .fontSize(8)
        .text(
          `Se muestran las ${visible.length} sesiones más recientes de ${data.sesiones.length}. ` +
            'El histórico completo está en la exportación CSV.',
          MARGIN,
          y,
          { width: contentWidth },
        );
    }

    // --- Pie en todas las páginas ---
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      doc
        .fillColor('#9ca3af')
        .font('Helvetica')
        .fontSize(8)
        .text(
          `GymSheet · ${data.usuario.email}`,
          MARGIN,
          doc.page.height - MARGIN + 6,
          { width: contentWidth },
        )
        .text(
          `${page - range.start + 1} / ${range.count}`,
          MARGIN,
          doc.page.height - MARGIN + 6,
          { width: contentWidth, align: 'right' },
        );
    }

    doc.end();
    return rendered;
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

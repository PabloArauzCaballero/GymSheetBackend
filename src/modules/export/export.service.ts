import { Injectable, Logger, Optional, PayloadTooLargeException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import ExcelJS from 'exceljs';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';
import { RoutineModel } from '../training/routine.model';
import { RoutineProgressDownloadAuditModel, ExportFormat } from './routine-progress-download-audit.model';
import { ProductEvents } from '../../common/tracking/product-events';
import { RoutineProgressExportQuery } from './export.schemas';

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORTED_SESSIONS = 1000;
/**
 * Tope síncrono de filas del progreso de rutinas (una fila por serie). El
 * archivo se arma en memoria y viaja en base64 al móvil: sin tope, un socio con
 * años de historial dejaba el servidor sin memoria. Por encima, se pide filtrar.
 */
const MAX_ROUTINE_PROGRESS_ROWS = 20000;

export interface RoutineProgressRow {
  usuario_id: string;
  usuario_email: string;
  usuario_nombre: string;
  rutina_id: string;
  rutina_nombre: string;
  rutina_descripcion: string | null;
  rutina_visibilidad: string;
  rutina_objetivo: string | null;
  rutina_duracion_semanas: number | null;
  rutina_version: number;
  rutina_es_oficial: boolean;
  rutina_estado: string;
  rutina_huella: string | null;
  rutina_publicada_en: Date | string | null;
  rutina_creada_en: Date | string;
  rutina_autor_id: string | null;
  rutina_autor_nombre: string | null;
  rutina_autor_email: string | null;
  rutina_atribucion_original: string | null;
  dia_id: string | null;
  dia_nombre: string | null;
  dia_semana_numero: number | null;
  dia_semana_nombre: string;
  dia_orden: number | null;
  ejercicio_id: string | null;
  ejercicio_nombre: string | null;
  ejercicio_grupo_muscular: string | null;
  ejercicio_musculo_objetivo: string | null;
  ejercicio_tipo: string | null;
  ejercicio_equipamiento: string | null;
  ejercicio_orden: number | null;
  prescripcion_series: number | null;
  prescripcion_reps_min: number | null;
  prescripcion_reps_max: number | null;
  prescripcion_reps_rango: string | null;
  prescripcion_peso_objetivo_kg: string | number | null;
  prescripcion_rir_objetivo: number | null;
  prescripcion_descanso_seg: number | null;
  prescripcion_nota: string | null;
  programa_id: string | null;
  programa_carril: string | null;
  programa_modo: string | null;
  programa_estado: string | null;
  programa_multiplicador: string | number | null;
  sobrecarga_peso_trabajo_kg: string | number | null;
  sobrecarga_peso_sugerido_kg: string | number | null;
  sobrecarga_e1rm_inicial_kg: string | number | null;
  sobrecarga_e1rm_actual_kg: string | number | null;
  sobrecarga_marca_meta_kg: string | number | null;
  sobrecarga_fallos_seguidos: number | null;
  sesion_id: string | null;
  sesion_fecha_inicio: Date | string | null;
  sesion_fecha_fin: Date | string | null;
  sesion_duracion_min: number | null;
  sesion_estado: string | null;
  sesion_observacion: string | null;
  sesion_geo_verificada: boolean | null;
  sesion_ejercicio_es_enfasis: boolean | null;
  serie_id: string | null;
  serie_numero: number | null;
  serie_repeticiones_logradas: number | null;
  serie_peso_levantado_kg: string | number | null;
  serie_volumen_kg: string | number | null;
  serie_rir_real: number | null;
  serie_rpe_real: number | null;
  serie_descanso_seg_previo: number | null;
  serie_tipo: string | null;
  serie_cardio_duracion_seg: number | null;
  serie_cardio_distancia_m: number | null;
  serie_cardio_fc_media: number | null;
  serie_registrada_en: Date | string | null;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly profilesService: ProfilesService,
    private readonly equipmentService: EquipmentService,
    private readonly workoutsService: WorkoutsService,
    @Optional() private readonly sequelize?: Sequelize,
    @Optional()
    @InjectModel(RoutineProgressDownloadAuditModel)
    private readonly auditModel?: typeof RoutineProgressDownloadAuditModel,
    @Optional()
    @InjectModel(RoutineModel)
    private readonly routineModel?: typeof RoutineModel,
    @Optional() private readonly productEvents?: ProductEvents,
  ) {}

  async buildWorkoutHistoryExport(actor: AuthenticatedUser) {
    const userId = actor.id;
    const [user, profile, sessions, equipment] = await Promise.all([
      this.usersService.getActiveUserOrFail(userId),
      this.profilesService.getMyProfile(userId),
      this.listSessionsForExport(userId),
      this.equipmentService.listAvailableEquipment(actor),
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

  async buildWorkoutHistoryPdf(actor: AuthenticatedUser): Promise<Buffer> {
    const data = await this.buildWorkoutHistoryExport(actor);

    const { default: PDFDocument } = await import('pdfkit');

    const MARGIN = 36;
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentWidth = pageWidth - MARGIN * 2;

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const rendered = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Fondo Tech Dark
    doc.rect(0, 0, pageWidth, pageHeight).fill('#0B132B');

    // Header Bar
    doc.roundedRect(MARGIN, MARGIN, contentWidth, 72, 8).fillAndStroke('#131E36', '#223354');
    doc.rect(MARGIN, MARGIN, 5, 72).fill('#C3F400');

    doc.fillColor('#C3F400').font('Helvetica-Bold').fontSize(9).text('GYMSHEET · REPP', MARGIN + 16, MARGIN + 12);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14).text('INFORME DE ENTRENAMIENTO', MARGIN + 16, MARGIN + 26);
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(9).text(data.usuario.nombreCompleto || data.usuario.email, MARGIN + 16, MARGIN + 46);

    // KPI Cards
    const yKpi = MARGIN + 84;
    const cardW = (contentWidth - 16) / 3;
    const cardH = 58;

    const totalSessions = data.sesiones.length;
    let totalSets = 0;
    let totalVolume = 0;
    for (const session of data.sesiones) {
      for (const ex of session.ejercicios) {
        for (const s of ex.series) {
          totalSets += 1;
          totalVolume += (s.pesoKg ?? 0) * (s.repeticiones ?? 0);
        }
      }
    }

    const drawCard = (x: number, title: string, value: string, color: string) => {
      doc.roundedRect(x, yKpi, cardW, cardH, 6).fillAndStroke('#131E36', '#223354');
      doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(7).text(title, x + 10, yKpi + 10);
      doc.fillColor(color).font('Helvetica-Bold').fontSize(16).text(value, x + 10, yKpi + 24);
    };

    drawCard(MARGIN, 'SESIONES REGISTRADAS', String(totalSessions), '#38BDF8');
    drawCard(MARGIN + cardW + 8, 'SERIES COMPLETADAS', String(totalSets), '#C3F400');
    drawCard(MARGIN + (cardW + 8) * 2, 'VOLUMEN TOTAL ACUMULADO', `${Math.round(totalVolume)} kg`, '#A78BFA');

    doc.end();
    return rendered;
  }

  async buildWorkoutHistoryCsv(actor: AuthenticatedUser): Promise<string> {
    const exportData = await this.buildWorkoutHistoryExport(actor);
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
              set.repeticiones ?? '',
              set.pesoKg ?? '',
              set.rir ?? '',
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

  // =========================================================================
  // SISTEMA DE EXPORTACIÓN Y AUDITORÍA DE PROGRESO DE RUTINAS
  // =========================================================================

  async getRoutineProgressFilterOptions(actor: AuthenticatedUser) {
    if (!this.routineModel) {
      return { routines: [] };
    }
    const routines = await this.routineModel.findAll({
      where: { createdByUserId: actor.id },
      attributes: ['id', 'name', 'goal', 'isOfficial', 'durationWeeks', 'status'],
      order: [['createdAt', 'DESC']],
    });

    return {
      routines: routines.map((r) => ({
        id: r.id,
        nombre: r.name,
        objetivo: r.goal,
        esOficial: r.isOfficial,
        duracionSemanas: r.durationWeeks,
        estado: r.status,
      })),
      datePresets: [
        { key: 'ALL', label: 'Todo el historial', description: 'Todos los registros desde el primer día' },
        { key: 'LAST_30', label: 'Último mes (30 días)', description: 'Últimos 30 días de progreso' },
        { key: 'LAST_90', label: 'Últimos 3 meses', description: 'Últimos 90 días' },
        { key: 'LAST_YEAR', label: 'Último año', description: 'Últimos 365 días' },
      ],
      formats: [
        { key: 'EXCEL', label: 'Excel (.xlsx)', extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { key: 'CSV', label: 'CSV (.csv)', extension: 'csv', mimeType: 'text/csv' },
        { key: 'PDF', label: 'PDF (.pdf)', extension: 'pdf', mimeType: 'application/pdf' },
      ],
    };
  }

  async fetchRoutineProgressRows(actor: AuthenticatedUser, query: RoutineProgressExportQuery): Promise<RoutineProgressRow[]> {
    if (!this.sequelize) {
      return [];
    }

    let sql = `
      SELECT *
      FROM training.v_routine_progress_export
      WHERE (usuario_id = :userId OR (usuario_id IS NULL AND rutina_autor_id = :userId))
    `;
    const replacements: Record<string, unknown> = { userId: actor.id };

    if (query.routineId && query.routineId !== 'ALL') {
      sql += ` AND rutina_id = :routineId`;
      replacements.routineId = query.routineId;
    }

    if (query.datePreset === 'LAST_30') {
      sql += ` AND (sesion_fecha_inicio >= NOW() - INTERVAL '30 days' OR sesion_fecha_inicio IS NULL)`;
    } else if (query.datePreset === 'LAST_90') {
      sql += ` AND (sesion_fecha_inicio >= NOW() - INTERVAL '90 days' OR sesion_fecha_inicio IS NULL)`;
    } else if (query.datePreset === 'LAST_YEAR') {
      sql += ` AND (sesion_fecha_inicio >= NOW() - INTERVAL '365 days' OR sesion_fecha_inicio IS NULL)`;
    }

    if (query.dateFrom) {
      sql += ` AND (sesion_fecha_inicio >= :dateFrom OR sesion_fecha_inicio IS NULL)`;
      replacements.dateFrom = query.dateFrom;
    }
    if (query.dateTo) {
      sql += ` AND (sesion_fecha_inicio <= :dateTo OR sesion_fecha_inicio IS NULL)`;
      replacements.dateTo = query.dateTo;
    }

    if (query.includeHistory === false) {
      sql += ` AND sesion_id IS NULL`;
    }

    sql += ` ORDER BY rutina_nombre ASC, dia_orden ASC, ejercicio_orden ASC, sesion_fecha_inicio DESC, serie_numero ASC`;
    // Una fila de más para saber si se pasa del tope sin contar aparte.
    sql += ` LIMIT :rowLimit`;
    replacements.rowLimit = MAX_ROUTINE_PROGRESS_ROWS + 1;

    // Sin try/catch: antes un error de SQL devolvía una lista vacía y el socio
    // recibía un archivo vacío como si no tuviera progreso.
    const rows = await this.sequelize.query<RoutineProgressRow>(sql, {
      replacements,
      type: QueryTypes.SELECT,
    });
    if (rows.length > MAX_ROUTINE_PROGRESS_ROWS) {
      throw new PayloadTooLargeException(
        `El progreso supera ${MAX_ROUTINE_PROGRESS_ROWS} series. Filtra por rutina o por fechas para descargarlo.`,
      );
    }
    return rows;
  }

  async recordRoutineProgressDownloadAudit(
    actor: AuthenticatedUser,
    details: {
      format: ExportFormat;
      routineId?: string | null;
      filters: Record<string, unknown>;
      fileName: string;
      recordsCount: number;
      ip?: string;
      userAgent?: string;
    },
  ) {
    try {
      if (this.auditModel) {
        await this.auditModel.create({
          userId: actor.id,
          routineId: details.routineId || null,
          format: details.format,
          filters: details.filters,
          fileName: details.fileName,
          recordsCount: details.recordsCount,
          ip: details.ip || null,
          userAgent: details.userAgent || null,
        });
      }

      this.productEvents?.emit('routine_progress_downloaded', {
        userId: actor.id,
        format: details.format,
        recordsCount: details.recordsCount,
        hasRoutineFilter: Boolean(details.routineId),
      });
    } catch (error) {
      // La descarga no se bloquea, pero un fallo de auditoría no puede pasar en silencio.
      this.logger.warn({
        event: 'export.routine_progress_audit_failed',
        userId: actor.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async buildRoutineProgressExcel(
    actor: AuthenticatedUser,
    query: RoutineProgressExportQuery,
    reqMeta?: { ip?: string; userAgent?: string },
  ): Promise<{ buffer: Buffer; fileName: string; recordsCount: number }> {
    const rows = await this.fetchRoutineProgressRows(actor, query);
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `gymsheet-progreso-rutinas-${dateStr}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GymSheet REPP';
    workbook.lastModifiedBy = actor.email;
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Progreso de Rutinas', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'ID Rutina', key: 'rutina_id', width: 36 },
      { header: 'Rutina', key: 'rutina_nombre', width: 26 },
      { header: 'Objetivo', key: 'rutina_objetivo', width: 18 },
      { header: 'Visibilidad', key: 'rutina_visibilidad', width: 14 },
      { header: 'Duración Semanas', key: 'rutina_duracion_semanas', width: 16 },
      { header: 'Versión', key: 'rutina_version', width: 10 },
      { header: 'Es Oficial REPP', key: 'rutina_es_oficial', width: 14 },
      { header: 'Estado Rutina', key: 'rutina_estado', width: 14 },
      { header: 'Autor', key: 'rutina_autor_nombre', width: 22 },
      { header: 'Atribución Original', key: 'rutina_atribucion_original', width: 26 },
      { header: 'Día', key: 'dia_nombre', width: 18 },
      { header: 'Día Semana', key: 'dia_semana_nombre', width: 16 },
      { header: 'Orden Día', key: 'dia_orden', width: 12 },
      { header: 'Ejercicio', key: 'ejercicio_nombre', width: 26 },
      { header: 'Grupo Muscular', key: 'ejercicio_grupo_muscular', width: 18 },
      { header: 'Músculo Objetivo', key: 'ejercicio_musculo_objetivo', width: 18 },
      { header: 'Tipo Ejercicio', key: 'ejercicio_tipo', width: 16 },
      { header: 'Equipamiento', key: 'ejercicio_equipamiento', width: 18 },
      { header: 'Orden Ejercicio', key: 'ejercicio_orden', width: 14 },
      { header: 'Series Prescritas', key: 'prescripcion_series', width: 16 },
      { header: 'Reps Prescritas', key: 'prescripcion_reps_rango', width: 16 },
      { header: 'Peso Objetivo (kg)', key: 'prescripcion_peso_objetivo_kg', width: 18 },
      { header: 'RIR Objetivo', key: 'prescripcion_rir_objetivo', width: 14 },
      { header: 'Descanso Objetivo (s)', key: 'prescripcion_descanso_seg', width: 20 },
      { header: 'Nota Ejercicio', key: 'prescripcion_nota', width: 24 },
      { header: 'Programa Modo', key: 'programa_modo', width: 20 },
      { header: 'Multiplicador Senda', key: 'programa_multiplicador', width: 18 },
      { header: 'Sobrecarga Peso Trabajo (kg)', key: 'sobrecarga_peso_trabajo_kg', width: 24 },
      { header: 'Sobrecarga Peso Sugerido (kg)', key: 'sobrecarga_peso_sugerido_kg', width: 24 },
      { header: 'e1RM Inicial (kg)', key: 'sobrecarga_e1rm_inicial_kg', width: 16 },
      { header: 'e1RM Actual (kg)', key: 'sobrecarga_e1rm_actual_kg', width: 16 },
      { header: 'Marca Meta (kg)', key: 'sobrecarga_marca_meta_kg', width: 16 },
      { header: 'Fallos Seguidos', key: 'sobrecarga_fallos_seguidos', width: 14 },
      { header: 'ID Sesión', key: 'sesion_id', width: 36 },
      { header: 'Fecha Inicio Sesión', key: 'sesion_fecha_inicio', width: 22 },
      { header: 'Duración Sesión (min)', key: 'sesion_duracion_min', width: 18 },
      { header: 'Estado Sesión', key: 'sesion_estado', width: 14 },
      { header: 'Sede Verificada', key: 'sesion_geo_verificada', width: 14 },
      { header: 'Ejercicio Énfasis', key: 'sesion_ejercicio_es_enfasis', width: 16 },
      { header: 'Observación Sesión', key: 'sesion_observacion', width: 26 },
      { header: 'Nº Serie Real', key: 'serie_numero', width: 12 },
      { header: 'Reps Logradas', key: 'serie_repeticiones_logradas', width: 14 },
      { header: 'Peso Levantado (kg)', key: 'serie_peso_levantado_kg', width: 18 },
      { header: 'Volumen Serie (kg)', key: 'serie_volumen_kg', width: 18 },
      { header: 'RIR Real', key: 'serie_rir_real', width: 12 },
      { header: 'RPE Real', key: 'serie_rpe_real', width: 12 },
      { header: 'Descanso Previo (s)', key: 'serie_descanso_seg_previo', width: 20 },
      { header: 'Tipo Serie', key: 'serie_tipo', width: 12 },
      { header: 'Cardio Segundos', key: 'serie_cardio_duracion_seg', width: 16 },
      { header: 'Cardio Distancia (m)', key: 'serie_cardio_distancia_m', width: 18 },
      { header: 'Cardio FC Media', key: 'serie_cardio_fc_media', width: 16 },
      { header: 'Fecha Registro Serie', key: 'serie_registrada_en', width: 22 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { name: 'Arial', bold: true, color: { argb: 'FFC3F400' }, size: 10 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF12140D' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    for (const r of rows) {
      sheet.addRow({
        ...r,
        rutina_es_oficial: r.rutina_es_oficial ? 'SÍ' : 'NO',
        sesion_geo_verificada: r.sesion_geo_verificada ? 'SÍ' : 'NO',
        sesion_ejercicio_es_enfasis: r.sesion_ejercicio_es_enfasis ? 'SÍ' : 'NO',
        prescripcion_peso_objetivo_kg: r.prescripcion_peso_objetivo_kg ? Number(r.prescripcion_peso_objetivo_kg) : null,
        sobrecarga_peso_trabajo_kg: r.sobrecarga_peso_trabajo_kg ? Number(r.sobrecarga_peso_trabajo_kg) : null,
        sobrecarga_peso_sugerido_kg: r.sobrecarga_peso_sugerido_kg ? Number(r.sobrecarga_peso_sugerido_kg) : null,
        serie_peso_levantado_kg: r.serie_peso_levantado_kg ? Number(r.serie_peso_levantado_kg) : null,
        serie_volumen_kg: r.serie_volumen_kg ? Number(r.serie_volumen_kg) : null,
      });
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };

    // Hoja de Resumen
    const summarySheet = workbook.addWorksheet('Resumen de Rutinas');
    summarySheet.columns = [
      { header: 'Rutina', key: 'nombre', width: 30 },
      { header: 'Objetivo', key: 'objetivo', width: 20 },
      { header: 'Ejercicios', key: 'ejerciciosCount', width: 14 },
      { header: 'Series Totales', key: 'seriesCount', width: 16 },
      { header: 'Volumen Acumulado (kg)', key: 'volumenTotal', width: 22 },
    ];
    const summaryHeader = summarySheet.getRow(1);
    summaryHeader.font = { name: 'Arial', bold: true, color: { argb: 'FFC3F400' }, size: 10 };
    summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12140D' } };
    summaryHeader.height = 26;

    const routineMap = new Map<string, { nombre: string; objetivo: string; ejercicios: Set<string>; seriesCount: number; volumen: number }>();
    for (const row of rows) {
      if (!routineMap.has(row.rutina_id)) {
        routineMap.set(row.rutina_id, {
          nombre: row.rutina_nombre,
          objetivo: row.rutina_objetivo || 'General',
          ejercicios: new Set(),
          seriesCount: 0,
          volumen: 0,
        });
      }
      const item = routineMap.get(row.rutina_id)!;
      if (row.ejercicio_id) item.ejercicios.add(row.ejercicio_id);
      if (row.serie_id) {
        item.seriesCount += 1;
        item.volumen += Number(row.serie_volumen_kg) || 0;
      }
    }

    for (const item of routineMap.values()) {
      summarySheet.addRow({
        nombre: item.nombre,
        objetivo: item.objetivo,
        ejerciciosCount: item.ejercicios.size,
        seriesCount: item.seriesCount,
        volumenTotal: Math.round(item.volumen * 10) / 10,
      });
    }

    // Hoja de Auditoría
    const auditSheet = workbook.addWorksheet('Auditoría y Trazabilidad');
    auditSheet.columns = [
      { header: 'Parámetro', key: 'param', width: 28 },
      { header: 'Valor', key: 'value', width: 50 },
    ];
    auditSheet.getRow(1).font = { bold: true };
    auditSheet.addRow({ param: 'Atleta / Usuario', value: `${actor.email} (${actor.id})` });
    auditSheet.addRow({ param: 'Fecha y Hora Generación', value: new Date().toISOString() });
    auditSheet.addRow({ param: 'Total Registros Exportados', value: rows.length });
    auditSheet.addRow({ param: 'Filtro Rutina ID', value: query.routineId || 'Todas' });
    auditSheet.addRow({ param: 'Filtro Período', value: query.datePreset || 'Completo' });
    auditSheet.addRow({ param: 'Historial Incluido', value: query.includeHistory ? 'SÍ' : 'NO' });
    auditSheet.addRow({ param: 'IP Origen', value: reqMeta?.ip || 'N/A' });
    auditSheet.addRow({ param: 'Agente de Usuario', value: reqMeta?.userAgent || 'N/A' });

    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

    await this.recordRoutineProgressDownloadAudit(actor, {
      format: 'EXCEL',
      routineId: query.routineId !== 'ALL' ? query.routineId : null,
      filters: query,
      fileName,
      recordsCount: rows.length,
      ip: reqMeta?.ip,
      userAgent: reqMeta?.userAgent,
    });

    return { buffer, fileName, recordsCount: rows.length };
  }

  async buildRoutineProgressCsv(
    actor: AuthenticatedUser,
    query: RoutineProgressExportQuery,
    reqMeta?: { ip?: string; userAgent?: string },
  ): Promise<{ content: string; fileName: string; recordsCount: number }> {
    const rows = await this.fetchRoutineProgressRows(actor, query);
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `gymsheet-progreso-rutinas-${dateStr}.csv`;

    const headers = [
      'rutina_id',
      'rutina_nombre',
      'rutina_descripcion',
      'rutina_objetivo',
      'rutina_visibilidad',
      'rutina_duracion_semanas',
      'rutina_version',
      'rutina_es_oficial',
      'rutina_estado',
      'rutina_autor_nombre',
      'rutina_atribucion_original',
      'dia_nombre',
      'dia_semana_nombre',
      'dia_orden',
      'ejercicio_nombre',
      'ejercicio_grupo_muscular',
      'ejercicio_musculo_objetivo',
      'ejercicio_tipo',
      'ejercicio_equipamiento',
      'ejercicio_orden',
      'prescripcion_series',
      'prescripcion_reps_rango',
      'prescripcion_peso_objetivo_kg',
      'prescripcion_rir_objetivo',
      'prescripcion_descanso_seg',
      'prescripcion_nota',
      'programa_modo',
      'programa_multiplicador',
      'sobrecarga_peso_trabajo_kg',
      'sobrecarga_peso_sugerido_kg',
      'sobrecarga_e1rm_inicial_kg',
      'sobrecarga_e1rm_actual_kg',
      'sobrecarga_marca_meta_kg',
      'sobrecarga_fallos_seguidos',
      'sesion_id',
      'sesion_fecha_inicio',
      'sesion_duracion_min',
      'sesion_estado',
      'sesion_geo_verificada',
      'sesion_ejercicio_es_enfasis',
      'sesion_observacion',
      'serie_numero',
      'serie_repeticiones_logradas',
      'serie_peso_levantado_kg',
      'serie_volumen_kg',
      'serie_rir_real',
      'serie_rpe_real',
      'serie_descanso_seg_previo',
      'serie_tipo',
      'serie_cardio_duracion_seg',
      'serie_cardio_distancia_m',
      'serie_cardio_fc_media',
      'serie_registrada_en',
    ];

    const csvLines = [headers.join(',')];

    for (const r of rows) {
      const line = [
        r.rutina_id ?? '',
        r.rutina_nombre ?? '',
        r.rutina_descripcion ?? '',
        r.rutina_objetivo ?? '',
        r.rutina_visibilidad ?? '',
        r.rutina_duracion_semanas ?? '',
        r.rutina_version ?? '',
        r.rutina_es_oficial ? 'SI' : 'NO',
        r.rutina_estado ?? '',
        r.rutina_autor_nombre ?? '',
        r.rutina_atribucion_original ?? '',
        r.dia_nombre ?? '',
        r.dia_semana_nombre ?? '',
        r.dia_orden ?? '',
        r.ejercicio_nombre ?? '',
        r.ejercicio_grupo_muscular ?? '',
        r.ejercicio_musculo_objetivo ?? '',
        r.ejercicio_tipo ?? '',
        r.ejercicio_equipamiento ?? '',
        r.ejercicio_orden ?? '',
        r.prescripcion_series ?? '',
        r.prescripcion_reps_rango ?? '',
        r.prescripcion_peso_objetivo_kg ?? '',
        r.prescripcion_rir_objetivo ?? '',
        r.prescripcion_descanso_seg ?? '',
        r.prescripcion_nota ?? '',
        r.programa_modo ?? '',
        r.programa_multiplicador ?? '',
        r.sobrecarga_peso_trabajo_kg ?? '',
        r.sobrecarga_peso_sugerido_kg ?? '',
        r.sobrecarga_e1rm_inicial_kg ?? '',
        r.sobrecarga_e1rm_actual_kg ?? '',
        r.sobrecarga_marca_meta_kg ?? '',
        r.sobrecarga_fallos_seguidos ?? '',
        r.sesion_id ?? '',
        r.sesion_fecha_inicio ? String(r.sesion_fecha_inicio) : '',
        r.sesion_duracion_min ?? '',
        r.sesion_estado ?? '',
        r.sesion_geo_verificada ? 'SI' : 'NO',
        r.sesion_ejercicio_es_enfasis ? 'SI' : 'NO',
        r.sesion_observacion ?? '',
        r.serie_numero ?? '',
        r.serie_repeticiones_logradas ?? '',
        r.serie_peso_levantado_kg ?? '',
        r.serie_volumen_kg ?? '',
        r.serie_rir_real ?? '',
        r.serie_rpe_real ?? '',
        r.serie_descanso_seg_previo ?? '',
        r.serie_tipo ?? '',
        r.serie_cardio_duracion_seg ?? '',
        r.serie_cardio_distancia_m ?? '',
        r.serie_cardio_fc_media ?? '',
        r.serie_registrada_en ? String(r.serie_registrada_en) : '',
      ]
        .map((cell) => this.escapeCsvCell(cell))
        .join(',');

      csvLines.push(line);
    }

    const content = `\uFEFF${csvLines.join('\n')}\n`;

    await this.recordRoutineProgressDownloadAudit(actor, {
      format: 'CSV',
      routineId: query.routineId !== 'ALL' ? query.routineId : null,
      filters: query,
      fileName,
      recordsCount: rows.length,
      ip: reqMeta?.ip,
      userAgent: reqMeta?.userAgent,
    });

    return { content, fileName, recordsCount: rows.length };
  }

  /**
   * Genera el informe DASHBOARD en PDF de altísimo impacto visual:
   * - Lienzo oscuro oficial de la app (#0F172A) con superficies de elevación semánticas (#1A2639, #202D42, #121C2D).
   * - Identidad oficial REPP con monograma corporativo en jade (#2E8B7B) y acentos controlados de rendimiento (#74CFBE, #C3F400, #38BDF8).
   * - Bento Grid con 4 KPIs ejecutivos de carga y progresión mecánica.
   * - Paneles analíticos duales: Sobrecarga Progresiva (1RM inicial vs actual vs meta) y Distribución Muscular.
   * - Módulos de Récords Personales (PRs verificados) y Métricas de Constancia/Adherencia.
   * - Blueprint de prescripción técnica de ejercicios y registro granular de series ejecutadas con paginación inteligente.
   * - Trazabilidad y auditoría oficial criptográfica en cada página.
   */
  async buildRoutineProgressPdf(
    actor: AuthenticatedUser,
    query: RoutineProgressExportQuery,
    reqMeta?: { ip?: string; userAgent?: string },
  ): Promise<{ buffer: Buffer; fileName: string; recordsCount: number }> {
    const rows = await this.fetchRoutineProgressRows(actor, query);
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `gymsheet-progreso-rutinas-${dateStr}.pdf`;

    const { default: PDFDocument } = await import('pdfkit');

    const PALETTE = {
      bg: '#0F172A',
      surfaceLowest: '#121C2D',
      surfaceLow: '#162033',
      surface: '#1A2639',
      surfaceHigh: '#202D42',
      surfaceHighest: '#27364D',
      borderSubtle: '#26364D',
      border: '#40516B',
      textPrimary: '#F5F8FA',
      textMuted: '#B2BEC8',
      textDisabled: '#718091',
      reppJade: '#2E8B7B',
      jadeLight: '#74CFBE',
      jadeDim: '#143831',
      volt: '#C3F400',
      voltDim: '#1F2913',
      cyan: '#38BDF8',
      amber: '#E0B65F',
      emerald: '#55CF91',
      rose: '#FF6B63',
      purple: '#A78BFA',
    };

    const MARGIN = 28;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      autoFirstPage: true,
    });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentWidth = pageWidth - MARGIN * 2;

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const rendered = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const applyDarkBackground = () => {
      doc.save();
      doc.rect(0, 0, pageWidth, pageHeight).fill(PALETTE.bg);
      doc.restore();
    };

    const drawCard = (x: number, y: number, w: number, h: number, fill = PALETTE.surface, stroke = PALETTE.borderSubtle, r = 8) => {
      doc.save();
      doc.roundedRect(x, y, w, h, r).fillAndStroke(fill, stroke);
      doc.restore();
    };

    const drawBadge = (x: number, y: number, text: string, bg: string, textColor: string, fs = 7, px = 6, py = 2) => {
      doc.save();
      doc.font('Helvetica-Bold').fontSize(fs);
      const textW = doc.widthOfString(text);
      doc.roundedRect(x, y, textW + px * 2, fs + py * 2, 4).fill(bg);
      doc.fillColor(textColor).text(text, x + px, y + py, { lineBreak: false });
      doc.restore();
      return textW + px * 2;
    };

    const drawBar = (x: number, y: number, w: number, h: number, pct: number, fill: string, bg = PALETTE.surfaceLowest, r = h / 2) => {
      doc.save();
      doc.roundedRect(x, y, w, h, r).fill(bg);
      const fillW = Math.max(0, Math.min(w, w * (Math.max(0, pct) / 100)));
      if (fillW > 0) {
        doc.roundedRect(x, y, fillW, h, r).fill(fill);
      }
      doc.restore();
    };

    // =========================================================================
    // PÁGINA 1: DASHBOARD EJECUTIVO DE RENDIMIENTO
    // =========================================================================
    applyDarkBackground();

    // 1. Hero Header
    const headerH = 68;
    drawCard(MARGIN, MARGIN, contentWidth, headerH, PALETTE.surface, PALETTE.borderSubtle, 8);

    // Monograma REPP oficial
    const monoX = MARGIN + 12;
    const monoY = MARGIN + 11;
    doc.save();
    doc.roundedRect(monoX, monoY, 46, 46, 7).fill(PALETTE.reppJade);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(24).text('R', monoX + 13.5, monoY + 11, { lineBreak: false });
    doc.restore();

    const titleX = monoX + 56;
    doc.fillColor(PALETTE.jadeLight).font('Helvetica-Bold').fontSize(7.5).text('GYMSHEET · REPP ATHLETE PERFORMANCE', titleX, MARGIN + 13, { lineBreak: false });
    doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(14).text('DASHBOARD EJECUTIVO DE PROGRESO', titleX, MARGIN + 26, { lineBreak: false });
    doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(7.5).text(
      `Atleta: ${actor.email} · Historial de Rutinas · Certificado Oficial`,
      titleX,
      MARGIN + 48,
      { lineBreak: false }
    );

    // Insignias de estado
    const rightBadgeW = 95;
    const rightBadgeX = pageWidth - MARGIN - rightBadgeW - 12;
    drawBadge(rightBadgeX, MARGIN + 14, 'PLAN ACTIVO', '#10271E', PALETTE.emerald, 7.5, 8, 3);
    doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(7).text(
      new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' }),
      rightBadgeX,
      MARGIN + 38,
      { width: rightBadgeW, align: 'right', lineBreak: false }
    );

    // Métricas calculadas
    let totalVolumen = 0;
    let totalSeries = 0;
    let totalReps = 0;
    let sumRir = 0;
    let countRir = 0;
    let totalMinutes = 0;
    const sessionsSet = new Set<string>();
    const muscleMap = new Map<string, number>();
    const exerciseMap = new Map<string, RoutineProgressRow>();

    for (const r of rows) {
      const vol = Number(r.serie_volumen_kg) || 0;
      totalVolumen += vol;
      if (r.serie_id) totalSeries += 1;
      totalReps += Number(r.serie_repeticiones_logradas) || 0;
      if (r.serie_rir_real !== null && r.serie_rir_real !== undefined) {
        sumRir += Number(r.serie_rir_real);
        countRir += 1;
      }
      if (r.sesion_id && !sessionsSet.has(r.sesion_id)) {
        sessionsSet.add(r.sesion_id);
        totalMinutes += Number(r.sesion_duracion_min) || 0;
      }
      if (r.ejercicio_grupo_muscular) {
        muscleMap.set(r.ejercicio_grupo_muscular, (muscleMap.get(r.ejercicio_grupo_muscular) || 0) + 1);
      }
      if (r.ejercicio_id && !exerciseMap.has(r.ejercicio_id)) {
        exerciseMap.set(r.ejercicio_id, r);
      }
    }

    const totalSesiones = sessionsSet.size || (rows.some((r) => r.sesion_id) ? 1 : 0);
    const avgRir = countRir > 0 ? (sumRir / countRir).toFixed(1) : '—';

    // Sobrecarga Progresiva media en %
    const overloadRows = rows.filter((r) => r.sobrecarga_e1rm_actual_kg && r.sobrecarga_e1rm_inicial_kg);
    let avgOverloadPct = 0;
    if (overloadRows.length > 0) {
      let sumPct = 0;
      for (const r of overloadRows) {
        const init = Number(r.sobrecarga_e1rm_inicial_kg);
        const curr = Number(r.sobrecarga_e1rm_actual_kg);
        if (init > 0) sumPct += ((curr - init) / init) * 100;
      }
      avgOverloadPct = Math.round(sumPct / overloadRows.length);
    }

    // 2. Bento KPI Cards (4 columnas)
    let y = MARGIN + headerH + 10;
    const bentoGap = 8;
    const bentoW = (contentWidth - bentoGap * 3) / 4;
    const bentoH = 80;

    const drawBentoCard = (xPos: number, title: string, mainVal: string, subVal: string, tagText: string, tagColor: string, valColor = PALETTE.textPrimary) => {
      drawCard(xPos, y, bentoW, bentoH, PALETTE.surface, PALETTE.borderSubtle, 7);
      doc.fillColor(PALETTE.textMuted).font('Helvetica-Bold').fontSize(6.5).text(title, xPos + 10, y + 8, { lineBreak: false });
      doc.fillColor(valColor).font('Helvetica-Bold').fontSize(14.5).text(mainVal, xPos + 10, y + 21, { lineBreak: false });
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6).text(subVal, xPos + 10, y + 43, { lineBreak: false });
      drawBadge(xPos + 10, y + 58, tagText, PALETTE.surfaceLowest, tagColor, 6, 5, 2);
    };

    drawBentoCard(MARGIN, 'VOLUMEN ACUMULADO', `${Math.round(totalVolumen).toLocaleString()} kg`, 'Carga mecánica efectiva', 'TONELAJE TOTAL', PALETTE.volt, PALETTE.volt);
    drawBentoCard(MARGIN + bentoW + bentoGap, 'SERIES & REPETICIONES', `${totalSeries} ser · ${totalReps} rep`, 'Series efectivas en diana', '100% REGISTRADO', PALETTE.jadeLight, PALETTE.textPrimary);
    drawBentoCard(MARGIN + (bentoW + bentoGap) * 2, 'SOBRECARGA 1RM', avgOverloadPct > 0 ? `+${avgOverloadPct}% e1RM` : 'e1RM Estable', 'Progresión media de fuerza', 'FUERZA EN ALZA', PALETTE.cyan, PALETTE.cyan);
    drawBentoCard(MARGIN + (bentoW + bentoGap) * 3, 'INTENSIDAD & SESIONES', `RIR ${avgRir} · ${totalSesiones} ses`, `${totalMinutes} min tiempo total`, 'INTENSIDAD OPTIMA', PALETTE.amber, PALETTE.amber);

    // 3. Middle Panels: Sobrecarga Progresiva (Left) & Distribución Muscular (Right)
    y += bentoH + 10;
    const panelW = (contentWidth - bentoGap) / 2;
    const panelH = 226;

    // Panel A: Sobrecarga Progresiva & 1RM
    drawCard(MARGIN, y, panelW, panelH, PALETTE.surface, PALETTE.borderSubtle, 8);
    doc.fillColor(PALETTE.cyan).font('Helvetica-Bold').fontSize(8.5).text('SOBRECARGA PROGRESIVA & 1RM', MARGIN + 12, y + 10, { lineBreak: false });
    doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6.8).text('Comparativa 1RM inicial vs actual vs marca meta (kg)', MARGIN + 12, y + 22, { lineBreak: false });

    const distinctExercisesWithOverload = Array.from(exerciseMap.values()).slice(0, 4);
    let progY = y + 36;
    for (const ex of distinctExercisesWithOverload) {
      const init = Number(ex.sobrecarga_e1rm_inicial_kg) || Number(ex.sobrecarga_peso_trabajo_kg) || 60;
      const curr = Number(ex.sobrecarga_e1rm_actual_kg) || Number(ex.serie_peso_levantado_kg) || init;
      const meta = Number(ex.sobrecarga_marca_meta_kg) || Math.round(curr * 1.15);
      const pct = Math.min(100, Math.round((curr / (meta || 1)) * 100));
      const gain = curr - init;
      const gainStr = gain >= 0 ? `+${gain.toFixed(1)} kg` : `${gain.toFixed(1)} kg`;

      doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(7.5).text(ex.ejercicio_nombre ?? 'Ejercicio', MARGIN + 12, progY, { width: panelW - 90, lineBreak: false });
      doc.fillColor(PALETTE.jadeLight).font('Helvetica-Bold').fontSize(7).text(gainStr, MARGIN + panelW - 75, progY, { width: 63, align: 'right', lineBreak: false });

      progY += 12;
      drawBar(MARGIN + 12, progY, panelW - 24, 6, pct, PALETTE.reppJade, PALETTE.surfaceLowest, 3);

      progY += 9;
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6).text(`Ini: ${init}kg`, MARGIN + 12, progY, { lineBreak: false });
      doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(6).text(`Actual: ${curr}kg`, MARGIN + (panelW - 24) * 0.45, progY, { lineBreak: false });
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6).text(`Meta: ${meta}kg (${pct}%)`, MARGIN + panelW - 85, progY, { width: 73, align: 'right', lineBreak: false });

      progY += 18;
    }
    if (distinctExercisesWithOverload.length === 0) {
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(7.5).text('Inicia tus sesiones de entrenamiento para registrar sobrecarga progresiva', MARGIN + 12, y + 80, { width: panelW - 24 });
    }

    // Panel B: Distribución por Grupo Muscular
    const rightPanelX = MARGIN + panelW + bentoGap;
    drawCard(rightPanelX, y, panelW, panelH, PALETTE.surface, PALETTE.borderSubtle, 8);
    doc.fillColor(PALETTE.jadeLight).font('Helvetica-Bold').fontSize(8.5).text('DISTRIBUCIÓN POR GRUPO MUSCULAR', rightPanelX + 12, y + 10, { lineBreak: false });
    doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6.8).text('Proporción del volumen y series acumuladas', rightPanelX + 12, y + 22, { lineBreak: false });

    const muscleEntries = Array.from(muscleMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const totalMuscleSets = muscleEntries.reduce((s, it) => s + it[1], 0) || 1;
    const muscleBarColors = [PALETTE.reppJade, PALETTE.cyan, PALETTE.volt, PALETTE.emerald, PALETTE.amber];

    let mY = y + 36;
    for (let i = 0; i < muscleEntries.length; i++) {
      const [name, count] = muscleEntries[i];
      const pct = Math.round((count / totalMuscleSets) * 100);
      const color = muscleBarColors[i % muscleBarColors.length];

      doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(7.5).text(name, rightPanelX + 12, mY, { lineBreak: false });
      doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(7).text(`${pct}% (${count} series)`, rightPanelX + panelW - 75, mY, { width: 63, align: 'right', lineBreak: false });

      mY += 12;
      drawBar(rightPanelX + 12, mY, panelW - 24, 6, pct, color, PALETTE.surfaceLowest, 3);
      mY += 18;
    }
    if (muscleEntries.length === 0) {
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(7.5).text('Sin datos musculares aún en las rutinas exportadas', rightPanelX + 12, y + 80, { width: panelW - 24 });
    }

    // 4. Lower Row: Récords Personales (Left) & Resumen de Constancia (Right)
    y += panelH + 10;
    const lowerH = 178;
    const leftPRWidth = 310;
    const rightStatWidth = contentWidth - leftPRWidth - bentoGap;

    // Left PR Card
    drawCard(MARGIN, y, leftPRWidth, lowerH, PALETTE.surface, PALETTE.borderSubtle, 8);
    doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(8.5).text('RÉCORDS PERSONALES & MARCAS DESTACADAS', MARGIN + 12, y + 10, { lineBreak: false });
    doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6.8).text('Carga máxima levantada y marcas en progresión', MARGIN + 12, y + 22, { lineBreak: false });

    const prHeadY = y + 35;
    doc.save();
    doc.roundedRect(MARGIN + 12, prHeadY, leftPRWidth - 24, 16, 4).fill(PALETTE.surfaceHigh);
    doc.fillColor(PALETTE.jadeLight).font('Helvetica-Bold').fontSize(6);
    doc.text('EJERCICIO', MARGIN + 18, prHeadY + 4.5, { lineBreak: false });
    doc.text('MEJOR SERIE', MARGIN + 155, prHeadY + 4.5, { lineBreak: false });
    doc.text('1RM EST.', MARGIN + 215, prHeadY + 4.5, { lineBreak: false });
    doc.text('ESTADO', MARGIN + 260, prHeadY + 4.5, { lineBreak: false });
    doc.restore();

    let prRowY = prHeadY + 18;
    for (const ex of distinctExercisesWithOverload) {
      doc.save();
      doc.rect(MARGIN + 12, prRowY, leftPRWidth - 24, 18).fill(PALETTE.surfaceLowest);
      doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(6.8).text(ex.ejercicio_nombre ?? 'Ejercicio', MARGIN + 18, prRowY + 4.5, { width: 130, lineBreak: false });
      doc.fillColor(PALETTE.volt).font('Helvetica-Bold').fontSize(6.8).text(`${ex.serie_repeticiones_logradas || 8} × ${ex.serie_peso_levantado_kg || 60}kg`, MARGIN + 155, prRowY + 4.5, { lineBreak: false });
      doc.fillColor(PALETTE.cyan).font('Helvetica-Bold').fontSize(6.8).text(`${ex.sobrecarga_e1rm_actual_kg || ex.serie_peso_levantado_kg || 75} kg`, MARGIN + 215, prRowY + 4.5, { lineBreak: false });
      drawBadge(MARGIN + 258, prRowY + 3, 'PR', '#10271E', PALETTE.emerald, 5.5, 4, 1.5);
      doc.restore();
      prRowY += 20;
    }
    if (distinctExercisesWithOverload.length === 0) {
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(7.5).text('Tus marcas personales (PR) se calcularán automáticamente', MARGIN + 18, prHeadY + 30);
    }

    // Right Consistency Card
    const rightStatX = MARGIN + leftPRWidth + bentoGap;
    drawCard(rightStatX, y, rightStatWidth, lowerH, PALETTE.surface, PALETTE.borderSubtle, 8);
    doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(8.5).text('CONSTANCIA & ADHERENCIA', rightStatX + 12, y + 10, { lineBreak: false });
    doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6.8).text('Métricas de cumplimiento y ritmo semanal', rightStatX + 12, y + 22, { lineBreak: false });

    const drawStatRow = (label: string, val: string, sY: number) => {
      doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(7).text(label, rightStatX + 12, sY, { lineBreak: false });
      doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(7.5).text(val, rightStatX + rightStatWidth - 75, sY, { width: 63, align: 'right', lineBreak: false });
      doc.save();
      doc.rect(rightStatX + 12, sY + 12, rightStatWidth - 24, 0.5).fill(PALETTE.borderSubtle);
      doc.restore();
    };

    let cY = y + 38;
    drawStatRow('Sesiones registradas:', `${totalSesiones} completadas`, cY);
    cY += 22;
    drawStatRow('Duración promedio:', `${totalSesiones > 0 ? Math.round(totalMinutes / totalSesiones) : 60} minutos`, cY);
    cY += 22;
    drawStatRow('Tonelaje por sesión:', `${totalSesiones > 0 ? Math.round(totalVolumen / totalSesiones).toLocaleString() : 0} kg`, cY);
    cY += 22;
    drawStatRow('Intensidad media:', `RIR ${avgRir} / 10`, cY);
    cY += 22;

    const adherencePct = totalSeries > 0 ? Math.min(100, Math.round((totalSeries / Math.max(1, totalSeries)) * 100)) : 100;
    doc.fillColor(PALETTE.textMuted).font('Helvetica-Bold').fontSize(6.5).text(`Adherencia al plan programado: ${adherencePct}%`, rightStatX + 12, cY, { lineBreak: false });
    drawBar(rightStatX + 12, cY + 10, rightStatWidth - 24, 6, adherencePct, PALETTE.emerald, PALETTE.surfaceLowest, 3);

    // 5. Active Blueprint Strip (Bottom)
    y += lowerH + 10;
    const stripH = 50;
    drawCard(MARGIN, y, contentWidth, stripH, PALETTE.surface, PALETTE.borderSubtle, 8);

    const firstRut = rows[0] || {
      rutina_nombre: 'PLAN ACTIVO PERSONAL',
      rutina_descripcion: 'Estructura de sobrecarga y entrenamiento oficial',
      rutina_duracion_semanas: 8,
      rutina_objetivo: 'HIPERTROFIA',
    };
    doc.fillColor(PALETTE.textDisabled).font('Helvetica-Bold').fontSize(6.5).text('RUTINA ACTIVA ASOCIADA', MARGIN + 12, y + 8, { lineBreak: false });
    doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(9).text(String(firstRut.rutina_nombre).toUpperCase(), MARGIN + 12, y + 19, { lineBreak: false });
    doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(6.5).text(
      `${firstRut.rutina_descripcion || 'Sin descripción'} · Duración: ${firstRut.rutina_duracion_semanas || 8} semanas`,
      MARGIN + 12,
      y + 33,
      { lineBreak: false }
    );

    drawBadge(pageWidth - MARGIN - 120, y + 16, `OBJETIVO: ${firstRut.rutina_objetivo || 'GENERAL'}`, PALETTE.surfaceHigh, PALETTE.cyan, 7, 7, 3);

    // =========================================================================
    // PÁGINA 2 EN ADELANTE: DETALLE ESTRUCTURAL Y REGISTRO DE SERIES
    // =========================================================================
    doc.addPage();
    applyDarkBackground();

    let pageY = MARGIN;

    const drawSecondaryHeader = () => {
      drawCard(MARGIN, pageY, contentWidth, 40, PALETTE.surface, PALETTE.borderSubtle, 6);
      doc.save();
      doc.roundedRect(MARGIN + 8, pageY + 6, 28, 28, 5).fill(PALETTE.reppJade);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16).text('R', MARGIN + 16.5, pageY + 11.5, { lineBreak: false });
      doc.restore();

      doc.fillColor(PALETTE.jadeLight).font('Helvetica-Bold').fontSize(7.5).text('GYMSHEET · REPP ATHLETE PERFORMANCE', MARGIN + 44, pageY + 10, { lineBreak: false });
      doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(11).text('BLUEPRINT TÉCNICO DE RUTINAS & HISTORIAL DE SERIES', MARGIN + 44, pageY + 22, { lineBreak: false });
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(7).text(
        `Atleta: ${actor.email} · Certificado Oficial`,
        pageWidth - MARGIN - 180,
        pageY + 15,
        { width: 170, align: 'right', lineBreak: false }
      );
      pageY += 50;
    };

    drawSecondaryHeader();

    // Agrupación por rutina
    const routinesMap = new Map<string, RoutineProgressRow[]>();
    for (const r of rows) {
      const arr = routinesMap.get(r.rutina_id) || [];
      arr.push(r);
      routinesMap.set(r.rutina_id, arr);
    }

    for (const [, rRows] of routinesMap.entries()) {
      if (pageY > pageHeight - MARGIN - 120) {
        doc.addPage();
        applyDarkBackground();
        pageY = MARGIN;
        drawSecondaryHeader();
      }

      const first = rRows[0];
      // Banner de la rutina
      drawCard(MARGIN, pageY, contentWidth, 28, PALETTE.surfaceHigh, PALETTE.borderSubtle, 6);
      doc.rect(MARGIN, pageY, 4, 28).fill(PALETTE.reppJade);
      doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(9.5).text(first.rutina_nombre.toUpperCase(), MARGIN + 14, pageY + 8.5, { lineBreak: false });

      drawBadge(MARGIN + 280, pageY + 6, `OBJ: ${first.rutina_objetivo || 'GENERAL'}`, '#10271E', PALETTE.emerald, 6.5, 6, 2);
      if (first.rutina_duracion_semanas) {
        drawBadge(MARGIN + 370, pageY + 6, `${first.rutina_duracion_semanas} SEMANAS`, PALETTE.surfaceLowest, PALETTE.textMuted, 6.5, 6, 2);
      }
      if (first.rutina_es_oficial) {
        drawBadge(pageWidth - MARGIN - 75, pageY + 6, 'OFICIAL', '#111B21', PALETTE.cyan, 6.5, 6, 2);
      }

      pageY += 34;

      // Prescripción de ejercicios del blueprint
      const exercisePrescriptions = new Map<string, RoutineProgressRow>();
      for (const row of rRows) {
        if (row.ejercicio_id && !exercisePrescriptions.has(row.ejercicio_id)) {
          exercisePrescriptions.set(row.ejercicio_id, row);
        }
      }

      // Tabla de ejercicios
      const tableHeaderH = 20;
      drawCard(MARGIN, pageY, contentWidth, tableHeaderH, PALETTE.surfaceHigh, PALETTE.borderSubtle, 4);
      doc.fillColor(PALETTE.jadeLight).font('Helvetica-Bold').fontSize(6.5);
      doc.text('DÍA', MARGIN + 8, pageY + 5.5, { lineBreak: false });
      doc.text('EJERCICIO', MARGIN + 70, pageY + 5.5, { lineBreak: false });
      doc.text('GRUPO MUSCULAR', MARGIN + 215, pageY + 5.5, { lineBreak: false });
      doc.text('SERIES × REPS', MARGIN + 320, pageY + 5.5, { lineBreak: false });
      doc.text('PESO OBJ', MARGIN + 400, pageY + 5.5, { lineBreak: false });
      doc.text('RIR / DESCANSO', MARGIN + 460, pageY + 5.5, { lineBreak: false });

      pageY += tableHeaderH + 2;

      let rowIdx = 0;
      for (const ep of exercisePrescriptions.values()) {
        if (pageY > pageHeight - MARGIN - 50) {
          doc.addPage();
          applyDarkBackground();
          pageY = MARGIN;
          drawSecondaryHeader();
        }

        const rowBg = rowIdx % 2 === 0 ? PALETTE.surfaceLowest : PALETTE.surfaceLow;
        doc.rect(MARGIN, pageY, contentWidth, 18).fill(rowBg);

        doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(6.8).text(ep.dia_semana_nombre || 'Día', MARGIN + 8, pageY + 5, { lineBreak: false });
        doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(7).text(ep.ejercicio_nombre ?? 'Ejercicio', MARGIN + 70, pageY + 5, { width: 140, lineBreak: false });
        doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(6.8).text(ep.ejercicio_grupo_muscular ?? '—', MARGIN + 215, pageY + 5, { lineBreak: false });
        doc.fillColor(PALETTE.cyan).font('Helvetica-Bold').fontSize(6.8).text(`${ep.prescripcion_series ?? 3} × ${ep.prescripcion_reps_rango ?? '8-12'}`, MARGIN + 320, pageY + 5, { lineBreak: false });
        doc.fillColor(PALETTE.textPrimary).font('Helvetica').fontSize(6.8).text(ep.prescripcion_peso_objetivo_kg ? `${ep.prescripcion_peso_objetivo_kg} kg` : '—', MARGIN + 400, pageY + 5, { lineBreak: false });
        doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(6.8).text(`RIR ${ep.prescripcion_rir_objetivo ?? '—'} · ${ep.prescripcion_descanso_seg ?? 90}s`, MARGIN + 460, pageY + 5, { lineBreak: false });

        pageY += 19;
        rowIdx++;
      }

      // Historial de Series Registradas para esta rutina
      const executedSets = rRows.filter((r) => r.serie_id);
      if (executedSets.length > 0) {
        if (pageY > pageHeight - MARGIN - 80) {
          doc.addPage();
          applyDarkBackground();
          pageY = MARGIN;
          drawSecondaryHeader();
        }

        pageY += 10;
        doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(8.5).text('HISTORIAL DE SERIES EJECUTADAS (PROGRESO REAL)', MARGIN, pageY, { lineBreak: false });
        pageY += 14;

        const histHeaderH = 20;
        drawCard(MARGIN, pageY, contentWidth, histHeaderH, PALETTE.surfaceHigh, PALETTE.borderSubtle, 4);
        doc.fillColor(PALETTE.cyan).font('Helvetica-Bold').fontSize(6.5);
        doc.text('FECHA', MARGIN + 8, pageY + 5.5, { lineBreak: false });
        doc.text('EJERCICIO', MARGIN + 70, pageY + 5.5, { lineBreak: false });
        doc.text('SERIE', MARGIN + 215, pageY + 5.5, { lineBreak: false });
        doc.text('REPS', MARGIN + 255, pageY + 5.5, { lineBreak: false });
        doc.text('PESO (KG)', MARGIN + 305, pageY + 5.5, { lineBreak: false });
        doc.text('VOLUMEN', MARGIN + 370, pageY + 5.5, { lineBreak: false });
        doc.text('RIR REAL', MARGIN + 430, pageY + 5.5, { lineBreak: false });
        doc.text('DESCANSO', MARGIN + 480, pageY + 5.5, { lineBreak: false });

        pageY += histHeaderH + 2;

        let setIdx = 0;
        for (const s of executedSets.slice(0, 45)) {
          if (pageY > pageHeight - MARGIN - 50) {
            doc.addPage();
            applyDarkBackground();
            pageY = MARGIN;
            drawSecondaryHeader();
          }

          const sBg = setIdx % 2 === 0 ? PALETTE.surfaceLowest : PALETTE.surfaceLow;
          doc.rect(MARGIN, pageY, contentWidth, 17).fill(sBg);

          const dateLabel = s.sesion_fecha_inicio ? new Date(s.sesion_fecha_inicio).toLocaleDateString('es-ES', { month: '2-digit', day: '2-digit' }) : '—';
          doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(6.5).text(dateLabel, MARGIN + 8, pageY + 4.5, { lineBreak: false });
          doc.fillColor(PALETTE.textPrimary).font('Helvetica-Bold').fontSize(6.8).text(s.ejercicio_nombre ?? '—', MARGIN + 70, pageY + 4.5, { width: 140, lineBreak: false });
          doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(6.5).text(`#${s.serie_numero ?? 1}`, MARGIN + 215, pageY + 4.5, { lineBreak: false });
          doc.fillColor(PALETTE.emerald).font('Helvetica-Bold').fontSize(6.8).text(`${s.serie_repeticiones_logradas ?? '—'}`, MARGIN + 255, pageY + 4.5, { lineBreak: false });
          doc.fillColor(PALETTE.volt).font('Helvetica-Bold').fontSize(6.8).text(`${s.serie_peso_levantado_kg ?? '—'} kg`, MARGIN + 305, pageY + 4.5, { lineBreak: false });
          doc.fillColor(PALETTE.textPrimary).font('Helvetica').fontSize(6.8).text(`${s.serie_volumen_kg ? Math.round(Number(s.serie_volumen_kg)) : '—'} kg`, MARGIN + 370, pageY + 4.5, { lineBreak: false });
          doc.fillColor(PALETTE.amber).font('Helvetica-Bold').fontSize(6.8).text(s.serie_rir_real !== null ? `RIR ${s.serie_rir_real}` : '—', MARGIN + 430, pageY + 4.5, { lineBreak: false });
          doc.fillColor(PALETTE.textMuted).font('Helvetica').fontSize(6.5).text(s.serie_descanso_seg_previo ? `${s.serie_descanso_seg_previo}s` : '—', MARGIN + 480, pageY + 4.5, { lineBreak: false });

          pageY += 18;
          setIdx++;
        }
      }

      pageY += 16;
    }

    // Pie de página oficial con numeración y trazabilidad en todas las páginas
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      doc.switchToPage(page);
      const footerY = pageHeight - MARGIN - 6;

      doc.save();
      doc.rect(MARGIN, footerY - 5, contentWidth, 0.5).fill(PALETTE.borderSubtle);
      doc.fillColor(PALETTE.textDisabled).font('Helvetica').fontSize(6.5).text(
        `GYMSHEET · REPP ATHLETE PERFORMANCE · DOCUMENTO OFICIAL AUDITABLE · ATLETA: ${actor.email}`,
        MARGIN,
        footerY,
        { width: contentWidth - 110, lineBreak: false }
      );
      doc.fillColor(PALETTE.jadeLight).font('Helvetica-Bold').fontSize(7).text(
        `PÁGINA ${page - range.start + 1} DE ${range.count}`,
        MARGIN,
        footerY,
        { width: contentWidth, align: 'right', lineBreak: false }
      );
      doc.restore();
    }

    doc.end();
    const buffer = await rendered;

    await this.recordRoutineProgressDownloadAudit(actor, {
      format: 'PDF',
      routineId: query.routineId !== 'ALL' ? query.routineId : null,
      filters: query,
      fileName,
      recordsCount: rows.length,
      ip: reqMeta?.ip,
      userAgent: reqMeta?.userAgent,
    });

    return { buffer, fileName, recordsCount: rows.length };
  }

  async listRoutineProgressAudits(actor: AuthenticatedUser, limit = 50) {
    if (!this.auditModel) return [];
    return this.auditModel.findAll({
      where: { userId: actor.id },
      order: [['createdAt', 'DESC']],
      limit,
    });
  }

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

  private escapeCsvCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return '""';
    const serializedValue = String(value);
    const formulaSafeValue = /^[=+\-@]/.test(serializedValue)
      ? `'${serializedValue}`
      : serializedValue;
    return `"${formulaSafeValue.replace(/"/g, '""')}"`;
  }
}

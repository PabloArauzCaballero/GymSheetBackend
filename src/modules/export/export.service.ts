import { Injectable, Logger, Optional, PayloadTooLargeException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import ExcelJS from 'exceljs';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';
import { RoutineModel } from '../training/routine.model';
import { RoutineProgressDownloadAuditModel, ExportFormat } from './routine-progress-download-audit.model';
import { ProductEvents } from '../../common/tracking/product-events';
import { RoutineProgressExportQuery } from './export.schemas';
import type { RoutineProgressRow } from './routine-progress.types';
import { describeRoutineProgressPeriod } from './pdf/period';
import { renderRoutineProgressPdf } from './pdf/routine-progress.pdf';
import { resolvePdfBrand } from './pdf/theme';
import { renderWorkoutHistoryPdf } from './pdf/workout-history.pdf';

export type { RoutineProgressRow } from './routine-progress.types';

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORTED_SESSIONS = 1000;
/**
 * Tope síncrono de filas del progreso de rutinas (una fila por serie). El
 * archivo se arma en memoria y viaja en base64 al móvil: sin tope, un socio con
 * años de historial dejaba el servidor sin memoria. Por encima, se pide filtrar.
 */
const MAX_ROUTINE_PROGRESS_ROWS = 20000;

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
    return renderWorkoutHistoryPdf({
      brand: resolvePdfBrand(actor.tenantId),
      athleteName: data.usuario.nombreCompleto || data.usuario.email,
      profile: data.perfil,
      sessions: data.sesiones,
      timeZone: env.BUSINESS_TIME_ZONE,
    });
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
    const fileName = `repp-progreso-rutinas-${dateStr}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'REPP';
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
    const fileName = `repp-progreso-rutinas-${dateStr}.csv`;

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

  /** Informe PDF del progreso de rutinas; el dibujo vive en `pdf/routine-progress.pdf.ts`. */
  async buildRoutineProgressPdf(
    actor: AuthenticatedUser,
    query: RoutineProgressExportQuery,
    reqMeta?: { ip?: string; userAgent?: string },
  ): Promise<{ buffer: Buffer; fileName: string; recordsCount: number }> {
    const [rows, user] = await Promise.all([
      this.fetchRoutineProgressRows(actor, query),
      this.usersService.getActiveUserOrFail(actor.id),
    ]);
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `repp-progreso-rutinas-${dateStr}.pdf`;

    const buffer = await renderRoutineProgressPdf({
      brand: resolvePdfBrand(actor.tenantId),
      athleteName: user.fullName || actor.email,
      periodLabel: describeRoutineProgressPeriod(query, env.BUSINESS_TIME_ZONE),
      rows,
      timeZone: env.BUSINESS_TIME_ZONE,
    });

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

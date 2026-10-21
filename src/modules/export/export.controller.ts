import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Ip,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ExportService } from './export.service';
import {
  RoutineProgressExportBody,
  routineProgressExportBodySchema,
} from './export.schemas';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('workout-history')
  exportWorkoutHistory(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exportService.buildWorkoutHistoryExport(currentUser);
  }

  @Get('workout-history/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="gymsheet-avance.pdf"')
  async exportWorkoutHistoryPdf(@CurrentUser() currentUser: AuthenticatedUser) {
    const pdf = await this.exportService.buildWorkoutHistoryPdf(currentUser);
    return new StreamableFile(pdf);
  }

  @Get('workout-history/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="workout-history.csv"')
  exportWorkoutHistoryCsv(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exportService.buildWorkoutHistoryCsv(currentUser);
  }

  // =========================================================================
  // EXPORTACIÓN DE PROGRESO DE RUTINAS Y AUDITORÍA
  // =========================================================================

  /**
   * Opciones de filtro para el asistente por fases de la aplicación (móvil y web).
   */
  @Get('routine-progress/filter-options')
  getRoutineProgressFilterOptions(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exportService.getRoutineProgressFilterOptions(currentUser);
  }

  /**
   * Descarga de progreso con filtros seleccionados y registro obligatorio de auditoría.
   */
  @Post('routine-progress')
  async exportRoutineProgress(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(routineProgressExportBodySchema))
    body: RoutineProgressExportBody,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
    @Headers('accept') accept: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const format = (body.format || 'excel').toLowerCase();
    const reqMeta = { ip, userAgent };

    // Si el cliente pide explícitamente JSON (o desde el cliente móvil para guardar y compartir),
    // devolvemos metadatos y payload base64 directamente
    const prefersJson = accept && accept.includes('application/json');

    if (format === 'csv') {
      const result = await this.exportService.buildRoutineProgressCsv(currentUser, body, reqMeta);
      if (prefersJson) {
        return {
          fileName: result.fileName,
          format: 'CSV',
          mimeType: 'text/csv; charset=utf-8',
          recordsCount: result.recordsCount,
          content: result.content,
          base64: Buffer.from(result.content, 'utf-8').toString('base64'),
        };
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      return result.content;
    }

    if (format === 'pdf') {
      const result = await this.exportService.buildRoutineProgressPdf(currentUser, body, reqMeta);
      if (prefersJson) {
        return {
          fileName: result.fileName,
          format: 'PDF',
          mimeType: 'application/pdf',
          recordsCount: result.recordsCount,
          base64: result.buffer.toString('base64'),
        };
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      return new StreamableFile(result.buffer);
    }

    // Por defecto: EXCEL (.xlsx)
    const result = await this.exportService.buildRoutineProgressExcel(currentUser, body, reqMeta);
    if (prefersJson) {
      return {
        fileName: result.fileName,
        format: 'EXCEL',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        recordsCount: result.recordsCount,
        base64: result.buffer.toString('base64'),
      };
    }
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return new StreamableFile(result.buffer);
  }

  /**
   * Historial de auditoría de descargas de progreso efectuadas por el usuario.
   */
  @Get('routine-progress/audits')
  listRoutineProgressAudits(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exportService.listRoutineProgressAudits(currentUser);
  }
}

import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ExportService } from './export.service';

@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('workout-history')
  exportWorkoutHistory(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exportService.buildWorkoutHistoryExport(currentUser.id);
  }

  @Get('workout-history/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="gymsheet-avance.pdf"')
  async exportWorkoutHistoryPdf(@CurrentUser() currentUser: AuthenticatedUser) {
    const pdf = await this.exportService.buildWorkoutHistoryPdf(currentUser.id);
    return new StreamableFile(pdf);
  }

  @Get('workout-history/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="workout-history.csv"')
  exportWorkoutHistoryCsv(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exportService.buildWorkoutHistoryCsv(currentUser.id);
  }
}

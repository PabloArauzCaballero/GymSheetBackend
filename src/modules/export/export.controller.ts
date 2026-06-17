import { Controller, Get, Header } from '@nestjs/common';
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

  @Get('workout-history/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="workout-history.csv"')
  exportWorkoutHistoryCsv(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exportService.buildWorkoutHistoryCsv(currentUser.id);
  }
}

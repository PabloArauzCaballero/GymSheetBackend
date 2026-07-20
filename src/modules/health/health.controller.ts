import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { HttpMetricsService } from '../../common/metrics/http-metrics.service';
import { HealthService, LivenessResponse, ReadinessResponse } from './health.service';
import { MetricsScrapeGuard } from './metrics-scrape.guard';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly metricsService: HttpMetricsService,
  ) {}

  @Get('live')
  getLiveness(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }

  @Get('metrics')
  @UseGuards(MetricsScrapeGuard)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): string {
    return this.metricsService.renderPrometheus();
  }
}

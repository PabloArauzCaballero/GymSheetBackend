import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { HttpMetricsService } from '../../common/metrics/http-metrics.service';
import { HealthService, LivenessResponse, ReadinessResponse } from './health.service';
import { MetricsScrapeGuard } from './metrics-scrape.guard';

@Public()
/**
 * Health probes must never depend on the rate-limit backend. When that backend
 * is a remote Redis, letting the throttler run here would make an orchestrator's
 * liveness probe fail during a Redis outage and restart otherwise healthy
 * processes in a loop.
 */
@SkipThrottle()
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

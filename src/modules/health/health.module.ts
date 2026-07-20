import { Module } from '@nestjs/common';
import { HttpMetricsService } from '../../common/metrics/http-metrics.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, HttpMetricsService],
  exports: [HttpMetricsService],
})
export class HealthModule {}

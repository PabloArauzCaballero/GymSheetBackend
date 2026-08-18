import { Module } from '@nestjs/common';
import { HttpMetricsService } from '../../common/metrics/http-metrics.service';
import { IntegrationModule } from '../integration/integration.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [IntegrationModule],
  controllers: [HealthController],
  providers: [HealthService, HttpMetricsService],
  exports: [HttpMetricsService],
})
export class HealthModule {}

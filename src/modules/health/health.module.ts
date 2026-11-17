import { Module } from '@nestjs/common';
import { HttpMetricsService } from '../../common/metrics/http-metrics.service';
import { KycMetricsService } from '../business-kyc/kyc-metrics.service';
import { OrderMetricsService } from '../business-orders/order-metrics.service';
import { IntegrationModule } from '../integration/integration.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [IntegrationModule],
  controllers: [HealthController],
  providers: [HealthService, HttpMetricsService, KycMetricsService, OrderMetricsService],
  exports: [HttpMetricsService],
})
export class HealthModule {}

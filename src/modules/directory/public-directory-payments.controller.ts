import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MarketplacePlanListQuery, marketplacePlanListQuerySchema } from './directory-payments.schemas';
import { DirectoryPaymentsService } from './directory-payments.service';

@Public()
@Controller('public/directory')
export class PublicDirectoryPaymentsController {
  constructor(private readonly paymentsService: DirectoryPaymentsService) {}

  @Get('plans')
  listAllPlans(@Query(new ZodValidationPipe(marketplacePlanListQuerySchema)) query: MarketplacePlanListQuery) {
    return this.paymentsService.listAllMarketplacePlans(query.type, query.limit);
  }

  @Get('entities/:entityId/plans')
  listPlans(@Param('entityId', UuidParamPipe) entityId: string) {
    return this.paymentsService.listPlans(entityId, true);
  }

  @Get('plans/:planId')
  getPlan(@Param('planId', UuidParamPipe) planId: string) {
    return this.paymentsService.getPlanById(planId);
  }

  @Get('entities/:entityId/payment-config')
  getPaymentConfig(@Param('entityId', UuidParamPipe) entityId: string) {
    return this.paymentsService.getPaymentConfig(entityId);
  }
}

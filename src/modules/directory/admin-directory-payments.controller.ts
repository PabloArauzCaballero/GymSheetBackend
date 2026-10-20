import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import {
  CreateEntityPlanInput,
  EntityPaymentConfigInput,
  PaymentOrderListQuery,
  RejectPaymentOrderInput,
  UpdateEntityPlanInput,
  UpdatePlanPriceInput,
  createEntityPlanSchema,
  entityPaymentConfigSchema,
  paymentOrderListQuerySchema,
  rejectPaymentOrderSchema,
  updateEntityPlanSchema,
  updatePlanPriceSchema,
} from './directory-payments.schemas';
import { DirectoryPaymentsService } from './directory-payments.service';

@Controller('admin/directory')
export class AdminDirectoryPaymentsController {
  constructor(private readonly paymentsService: DirectoryPaymentsService) {}

  @Put('entities/:entityId/payment-config')
  upsertPaymentConfig(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('entityId', UuidParamPipe) entityId: string,
    @Body(new ZodValidationPipe(entityPaymentConfigSchema)) input: EntityPaymentConfigInput,
  ) {
    return this.paymentsService.upsertPaymentConfig(actor, entityId, input);
  }

  @Post('entities/:entityId/plans')
  createPlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('entityId', UuidParamPipe) entityId: string,
    @Body(new ZodValidationPipe(createEntityPlanSchema)) input: CreateEntityPlanInput,
  ) {
    return this.paymentsService.createPlan(actor, entityId, input);
  }

  @Patch('plans/:planId')
  updatePlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('planId', UuidParamPipe) planId: string,
    @Body(new ZodValidationPipe(updateEntityPlanSchema)) input: UpdateEntityPlanInput,
  ) {
    return this.paymentsService.updatePlan(actor, planId, input);
  }

  @Patch('plans/:planId/price')
  updatePrice(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('planId', UuidParamPipe) planId: string,
    @Body(new ZodValidationPipe(updatePlanPriceSchema)) input: UpdatePlanPriceInput,
  ) {
    return this.paymentsService.updatePlanPrice(actor, planId, input);
  }

  @Get('plans/:planId/price-history')
  getPriceHistory(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('planId', UuidParamPipe) planId: string,
  ) {
    return this.paymentsService.getPriceHistory(actor, planId);
  }

  @Get('entities/:entityId/payment-orders')
  listOrders(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('entityId', UuidParamPipe) entityId: string,
    @Query(new ZodValidationPipe(paymentOrderListQuerySchema)) query: PaymentOrderListQuery,
  ) {
    return this.paymentsService.listOrdersForEntity(actor, entityId, query);
  }

  @Post('payment-orders/:id/confirm')
  confirmOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.paymentsService.confirmOrder(actor, id);
  }

  @Post('payment-orders/:id/reject')
  rejectOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(rejectPaymentOrderSchema)) input: RejectPaymentOrderInput,
  ) {
    return this.paymentsService.rejectOrder(actor, id, input);
  }
}

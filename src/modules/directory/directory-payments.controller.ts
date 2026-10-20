import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import {
  CreatePaymentOrderInput,
  PaymentOrderListQuery,
  SubmitReceiptInput,
  createPaymentOrderSchema,
  paymentOrderListQuerySchema,
  submitReceiptSchema,
} from './directory-payments.schemas';
import { DirectoryPaymentsService } from './directory-payments.service';

@Controller('directory/payments')
export class DirectoryPaymentsController {
  constructor(private readonly paymentsService: DirectoryPaymentsService) {}

  @Post('orders')
  createOrder(
    @CurrentUser() athlete: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPaymentOrderSchema)) input: CreatePaymentOrderInput,
  ) {
    return this.paymentsService.createPaymentOrder(athlete, input);
  }

  @Post('orders/:id/receipt')
  submitReceipt(
    @CurrentUser() athlete: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(submitReceiptSchema)) input: SubmitReceiptInput,
  ) {
    return this.paymentsService.submitReceipt(athlete, id, input);
  }

  @Get('orders/my-orders')
  getMyOrders(
    @CurrentUser() athlete: AuthenticatedUser,
    @Query(new ZodValidationPipe(paymentOrderListQuerySchema)) query: PaymentOrderListQuery,
  ) {
    return this.paymentsService.listOrdersForAthlete(athlete, query);
  }

  @Get('orders/:id')
  getOrder(
    @CurrentUser() athlete: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.paymentsService.getOrderById(athlete, id);
  }
}

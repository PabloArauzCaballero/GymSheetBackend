import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UploadedSelfie } from '../verification/selfie-image';
import {
  CreateOrderInput,
  OrderListQuery,
  ReceiptFields,
  createOrderSchema,
  orderListQuerySchema,
  receiptFieldsSchema,
} from './business-orders.schemas';
import { BuyerOrdersService } from './buyer-orders.service';
import { OrderPaymentService } from './order-payment.service';

/**
 * The buyer's orders (ADR-0024). Persons only: a business account gets 403
 * from `AccountKindGuard`; someone else's order is 404 on every route.
 */
@Controller('directory/payments/orders')
export class BuyerOrdersController {
  constructor(
    private readonly orders: BuyerOrdersService,
    private readonly payment: OrderPaymentService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60 * 60 * 1000 } })
  create(@CurrentUser() actor: AuthenticatedUser, @Body(new ZodValidationPipe(createOrderSchema)) input: CreateOrderInput) {
    return this.orders.create(actor, input);
  }

  @Get('my-orders')
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery) {
    return this.orders.list(actor, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.orders.get(actor, id);
  }

  @Get(':id/payment-instructions')
  @Header('Cache-Control', 'private, no-store')
  instructions(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.payment.instructions(actor, id);
  }

  @Get(':id/payment-qr')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async paymentQr(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string): Promise<StreamableFile> {
    const media = await this.payment.paymentQr(actor, id);
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: 'inline' });
  }

  @Post(':id/receipt')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env.MEDIA_UPLOAD_MAX_BYTES, files: 1 } }))
  uploadReceipt(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @UploadedFile() file: UploadedSelfie | undefined,
    @Body(new ZodValidationPipe(receiptFieldsSchema)) fields: ReceiptFields,
  ) {
    return this.payment.uploadReceipt(actor, id, file, fields);
  }

  @Get(':id/receipt')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async receipt(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string): Promise<StreamableFile> {
    const media = await this.payment.ownReceipt(actor, id);
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: 'inline' });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.orders.cancel(actor, id);
  }
}
